const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const Alert = require("../models/alert");
const User = require("../models/user");
const requireAuth = require("../middleware/auth");
const { startAlert, endAlert } = require("../services/sos");
const { channelStatus } = require("../services/notify");

const router = express.Router();

const MAX_PATH_POINTS = 2000;
// Location stays visible on the tracking page for this long after an alert ends.
const TRACKING_GRACE_MS = 60 * 60 * 1000;

const trackLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

const parsePoint = (body) => {
  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracy = Number(body.accuracy);
  return { lat, lng, accuracy: Number.isFinite(accuracy) ? accuracy : null, at: new Date() };
};

// Owner's view of an alert, without the secret contact keys.
const ownerView = (alert) => ({
  id: alert._id,
  status: alert.status,
  layer: alert.layer,
  createdAt: alert.createdAt,
  endedAt: alert.endedAt,
  acknowledgedBy: alert.acknowledgedBy,
  startLocation: alert.startLocation,
  lastLocation: alert.lastLocation,
  shareToken: alert.shareToken,
  notifications: alert.notifications.map((n) => ({
    name: n.name,
    layer: n.layer,
    email: n.email,
    sms: n.sms,
    acknowledgedAt: n.acknowledgedAt,
    sentAt: n.sentAt,
  })),
});

const findOwnAlert = async (req) => {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return Alert.findOne({ _id: req.params.id, userId: req.user.id });
};

/* ---------- Public: live tracking page for trusted contacts ---------- */

router.get("/track/:token", trackLimiter, async (req, res) => {
  try {
    const alert = await Alert.findOne({ shareToken: req.params.token });
    if (!alert) return res.status(404).json({ message: "This tracking link is invalid" });

    const user = await User.findById(alert.userId);
    const expired = alert.endedAt && Date.now() - alert.endedAt.getTime() > TRACKING_GRACE_MS;
    const viewer = alert.notifications.find((n) => n.key === req.query.c);

    res.status(200).json({
      status: alert.status,
      createdAt: alert.createdAt,
      endedAt: alert.endedAt,
      layer: alert.layer,
      acknowledgedBy: alert.acknowledgedBy,
      viewer: viewer ? { name: viewer.name, acknowledged: Boolean(viewer.acknowledgedAt) } : null,
      person: user
        ? { firstName: user.firstName, lastName: user.lastName, phone: user.phone, medicalNotes: user.medicalNotes }
        : null,
      // Stop exposing location data once the alert has been over for a while.
      lastLocation: expired ? null : alert.lastLocation,
      path: expired ? [] : alert.path.slice(-300).map((p) => [p.lat, p.lng]),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/track/:token/ack", trackLimiter, async (req, res) => {
  try {
    const alert = await Alert.findOne({ shareToken: req.params.token });
    if (!alert) return res.status(404).json({ message: "This tracking link is invalid" });

    const notification = alert.notifications.find((n) => n.key === req.body?.key);
    if (!notification) return res.status(403).json({ message: "This link cannot acknowledge the alert" });

    if (!notification.acknowledgedAt) {
      await Alert.updateOne(
        { _id: alert._id, "notifications.key": notification.key },
        {
          $set: {
            "notifications.$.acknowledgedAt": new Date(),
            ...(alert.acknowledgedBy ? {} : { acknowledgedBy: notification.name }),
          },
        }
      );
    }

    res.status(200).json({ message: "Thank you. They can see that you are responding." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ---------- Authenticated: the person in danger ---------- */

router.use(requireAuth);

router.get("/channels", (req, res) => {
  res.status(200).json({
    ...channelStatus(),
    escalationIntervalSeconds: Number(process.env.ESCALATION_INTERVAL_SECONDS || 60),
  });
});

router.post("/trigger", async (req, res) => {
  try {
    const existing = await Alert.findOne({ userId: req.user.id, status: "active" });
    if (existing) {
      return res.status(200).json({ message: "Alert already active", alert: ownerView(existing) });
    }

    const alert = await startAlert(req.user.id, parsePoint(req.body));
    res.status(201).json({ message: "Emergency alert sent", alert: ownerView(alert) });
  } catch (error) {
    if (error.code === 11000) {
      const existing = await Alert.findOne({ userId: req.user.id, status: "active" });
      if (existing) return res.status(200).json({ message: "Alert already active", alert: ownerView(existing) });
    }
    res.status(500).json({ message: error.message });
  }
});

router.get("/active", async (req, res) => {
  try {
    const alert = await Alert.findOne({ userId: req.user.id, status: "active" });
    res.status(200).json({ alert: alert ? ownerView(alert) : null });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const alerts = await Alert.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(100);
    res.status(200).json(alerts.map(ownerView));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/:id/location", async (req, res) => {
  try {
    const point = parsePoint(req.body);
    if (!point) return res.status(400).json({ message: "Invalid coordinates" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Alert not found" });

    // Atomic push so location updates never conflict with escalation saves.
    const result = await Alert.updateOne(
      { _id: req.params.id, userId: req.user.id, status: "active" },
      { $push: { path: { $each: [point], $slice: -MAX_PATH_POINTS } } }
    );

    if (!result.matchedCount) return res.status(404).json({ message: "No active alert" });
    res.status(200).json({ message: "Location updated" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/:id/resolve", async (req, res) => {
  try {
    const alert = await findOwnAlert(req);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    if (alert.status !== "active") return res.status(200).json({ alert: ownerView(alert) });

    const outcome = req.body?.outcome === "cancelled" ? "cancelled" : "resolved";
    await endAlert(alert, outcome);
    res.status(200).json({ message: "Your contacts have been told you are safe", alert: ownerView(alert) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
