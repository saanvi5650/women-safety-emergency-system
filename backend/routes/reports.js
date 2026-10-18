const express = require("express");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");
const Report = require("../models/report");
const requireAuth = require("../middleware/auth");
const { CATEGORIES } = require("../models/report");
const { inServiceArea } = require("../config/region");

const router = express.Router();

router.use(requireAuth);

const reportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "You have submitted many reports recently, please try again later" },
});

const MAX_RADIUS_M = 20000;
const MAX_BBOX_DEG = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const isNight = (date) => {
  const hour = new Date(date).getHours();
  return hour >= 19 || hour < 6;
};

const distanceMeters = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

// Combines nearby reports into a 0-100 safety score. Closer, more severe,
// more recent and more confirmed reports count more; night-time reports
// count extra when it is currently night.
const safetyScore = (reports, lat, lng, radius, now = new Date()) => {
  let risk = 0;
  for (const r of reports) {
    const [rLng, rLat] = r.location.coordinates;
    const proximity = Math.max(0, 1 - distanceMeters(lat, lng, rLat, rLng) / radius);
    const ageDays = (now - r.occurredAt) / DAY_MS;
    const recency = Math.pow(0.5, ageDays / 180);
    const confirmations = 1 + Math.min(r.confirmations.length, 8) * 0.25;
    const timeMatch = isNight(now) && isNight(r.occurredAt) ? 1.5 : 1;
    risk += r.severity * proximity * recency * confirmations * timeMatch;
  }
  const score = Math.round(100 * Math.exp(-risk / 6));
  const level = score >= 75 ? "safe" : score >= 50 ? "moderate" : "caution";
  return { score, level, reports: reports.length };
};

const parseLatLng = (query) => {
  const lat = Number(query.lat);
  const lng = Number(query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
};

router.get("/categories", (req, res) => {
  res.status(200).json(CATEGORIES);
});

// GET /api/reports?bbox=minLng,minLat,maxLng,maxLat  or  ?lat=..&lng=..&radius=..
router.get("/", async (req, res) => {
  try {
    let filter;

    if (req.query.bbox) {
      const [minLng, minLat, maxLng, maxLat] = String(req.query.bbox).split(",").map(Number);
      if ([minLng, minLat, maxLng, maxLat].some((n) => !Number.isFinite(n))) {
        return res.status(400).json({ message: "Invalid bbox" });
      }
      // Very zoomed-out views would need a huge polygon; show reports only at city scale.
      if (maxLng - minLng > MAX_BBOX_DEG || maxLat - minLat > MAX_BBOX_DEG) {
        return res.status(200).json([]);
      }
      filter = {
        location: {
          $geoWithin: {
            $geometry: {
              type: "Polygon",
              coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]],
            },
          },
        },
      };
    } else {
      const point = parseLatLng(req.query);
      if (!point) return res.status(400).json({ message: "Provide bbox or lat/lng" });
      const radius = Math.min(Number(req.query.radius) || 3000, MAX_RADIUS_M);
      filter = {
        location: {
          $geoWithin: { $centerSphere: [[point.lng, point.lat], radius / 6378137] },
        },
      };
    }

    const reports = await Report.find(filter).sort({ occurredAt: -1 }).limit(500);
    res.status(200).json(reports.map((r) => r.toPublic(req.user.id)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/score", async (req, res) => {
  try {
    const point = parseLatLng(req.query);
    if (!point) return res.status(400).json({ message: "Invalid coordinates" });
    const radius = Math.min(Number(req.query.radius) || 500, 5000);

    const reports = await Report.find({
      location: { $geoWithin: { $centerSphere: [[point.lng, point.lat], radius / 6378137] } },
    });

    res.status(200).json({ ...safetyScore(reports, point.lat, point.lng, radius), radius });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/", reportLimiter, async (req, res) => {
  try {
    const point = parseLatLng(req.body || {});
    if (!point) return res.status(400).json({ message: "Invalid coordinates" });
    if (!inServiceArea(point.lat, point.lng)) {
      return res.status(400).json({ message: "SheShield currently accepts reports from India only" });
    }

    const { category, description } = req.body;
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ message: "Please choose a valid category" });
    }

    const severity = Math.min(3, Math.max(1, Number(req.body.severity) || 2));
    let occurredAt = req.body.occurredAt ? new Date(req.body.occurredAt) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || occurredAt > new Date()) occurredAt = new Date();

    const report = await Report.create({
      reportedBy: req.user.id,
      location: { type: "Point", coordinates: [point.lng, point.lat] },
      category,
      severity,
      description,
      occurredAt,
    });

    res.status(201).json({ message: "Thank you for keeping others safe", report: report.toPublic(req.user.id) });
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

// Toggle "I've seen this too" on someone else's report.
router.post("/:id/confirm", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Report not found" });
    const report = await Report.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.reportedBy.equals(req.user.id)) {
      return res.status(400).json({ message: "You cannot confirm your own report" });
    }

    const already = report.confirmations.some((id) => id.equals(req.user.id));
    await Report.updateOne(
      { _id: report._id },
      already ? { $pull: { confirmations: req.user.id } } : { $addToSet: { confirmations: req.user.id } }
    );

    const updated = await Report.findById(report._id);
    res.status(200).json({ report: updated.toPublic(req.user.id) });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Report not found" });
    const result = await Report.deleteOne({ _id: req.params.id, reportedBy: req.user.id });
    if (!result.deletedCount) return res.status(404).json({ message: "Report not found" });
    res.status(200).json({ message: "Report removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
module.exports.safetyScore = safetyScore;
