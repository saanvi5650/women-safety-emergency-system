const crypto = require("crypto");
const Alert = require("../models/alert");
const Contact = require("../models/contact");
const User = require("../models/user");
const { sendEmail, sendSMS } = require("./notify");

// Seconds between escalation layers when no contact has acknowledged the alert.
const escalationInterval = () => Number(process.env.ESCALATION_INTERVAL_SECONDS || 60);
// Alerts left open longer than this are closed automatically.
const ALERT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const randomToken = (bytes) => crypto.randomBytes(bytes).toString("base64url");

const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, "");

const trackUrl = (alert, key) => `${appUrl()}/track.html?t=${alert.shareToken}&c=${key}`;

const mapsUrl = (point) => (point ? `https://maps.google.com/?q=${point.lat},${point.lng}` : null);

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

// Contacts are grouped by priority; layer N alerts the N-th group.
// A final extra layer re-alerts everyone who has not responded.
const priorityGroups = (contacts) => {
  const priorities = [...new Set(contacts.map((c) => c.priority))].sort((a, b) => a - b);
  return priorities.map((p) => contacts.filter((c) => c.priority === p));
};

const buildSosMessage = (user, alert, key, isReminder) => {
  const name = `${user.firstName} ${user.lastName}`;
  const link = trackUrl(alert, key);
  const point = alert.lastLocation;
  const time = new Date(alert.createdAt).toLocaleString("en-IN", { timeZone: process.env.TZ || "Asia/Kolkata" });
  const prefix = isReminder ? "REMINDER - " : "";

  const sms = `${prefix}SOS from ${name} via SheShield. Live location: ${link} Call ${user.firstName}: ${user.phone}`;

  const text = [
    `${prefix}${name} has triggered an SOS emergency alert on SheShield.`,
    "",
    `Time: ${time}`,
    `Live tracking: ${link}`,
    point ? `Last known location: ${mapsUrl(point)}` : "Location: not available yet",
    `Call ${user.firstName}: ${user.phone}`,
    user.medicalNotes ? `Medical notes: ${user.medicalNotes}` : "",
    "",
    "Open the tracking link and tap \"I'm responding\" so others know help is on the way.",
    "If you believe they are in immediate danger, call 112 (India emergency) right away.",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `
  <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #f3c6d3;border-radius:16px;overflow:hidden">
    <div style="background:#c81c41;color:#fff;padding:20px 24px">
      <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;opacity:.85">${prefix}SheShield emergency alert</div>
      <div style="font-size:24px;font-weight:bold;margin-top:6px">${escapeHtml(name)} needs help</div>
    </div>
    <div style="padding:22px 24px;color:#22151c;line-height:1.6">
      <p style="margin:0 0 12px">${escapeHtml(user.firstName)} triggered an SOS at <strong>${escapeHtml(time)}</strong>.</p>
      <p style="margin:0 0 20px">
        <a href="${link}" style="display:inline-block;background:#e65278;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">View live location</a>
        &nbsp;
        <a href="tel:${escapeHtml(user.phone)}" style="display:inline-block;background:#3b2732;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Call ${escapeHtml(user.firstName)}</a>
      </p>
      ${point ? `<p style="margin:0 0 8px">Last known location: <a href="${mapsUrl(point)}">${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}</a></p>` : ""}
      ${user.medicalNotes ? `<p style="margin:0 0 8px"><strong>Medical notes:</strong> ${escapeHtml(user.medicalNotes)}</p>` : ""}
      <p style="margin:16px 0 0;font-size:13px;color:#695964">Open the link and tap <em>I'm responding</em> so other contacts know help is on the way.
      If you believe ${escapeHtml(user.firstName)} is in immediate danger, call <strong>112</strong>.</p>
    </div>
  </div>`;

  return { sms, text, html, subject: `${prefix}SOS: ${name} needs help` };
};

// Sends email + SMS to one contact and records the result on the in-memory alert.
// Returns the notification entry and whether it is new, so it can be persisted atomically.
const notifyContact = async (user, alert, contact, layer, isReminder) => {
  const existing = alert.notifications.find((n) => n.contactId && n.contactId.equals(contact._id));
  const key = existing ? existing.key : randomToken(8);
  const message = buildSosMessage(user, alert, key, isReminder);

  const [email, sms] = await Promise.all([
    sendEmail({ to: contact.email, subject: message.subject, text: message.text, html: message.html }),
    sendSMS({ to: contact.phone, body: message.sms }),
  ]);

  if (existing) {
    Object.assign(existing, { email, sms, sentAt: new Date() });
    return { entry: existing, isNew: false };
  }
  const entry = { contactId: contact._id, name: contact.name, layer, key, email, sms, sentAt: new Date() };
  alert.notifications.push(entry);
  return { entry, isNew: true };
};

// Sends the next escalation layer. Returns false when there is nothing left to escalate.
const escalate = async (alert) => {
  const [user, contacts] = await Promise.all([
    User.findById(alert.userId),
    Contact.find({ userId: alert.userId }).sort({ priority: 1, createdAt: 1 }),
  ]);
  if (!user) return false;

  const groups = priorityGroups(contacts);
  const nextLayer = alert.layer + 1;

  let targets;
  let isReminder = false;
  if (nextLayer <= groups.length) {
    targets = groups[nextLayer - 1];
  } else if (nextLayer === groups.length + 1 && groups.length > 0) {
    // Maximum emergency mode: remind everyone who has not acknowledged yet.
    isReminder = true;
    targets = contacts.filter((contact) => {
      const n = alert.notifications.find((x) => x.contactId && x.contactId.equals(contact._id));
      return !n || !n.acknowledgedAt;
    });
  } else {
    return false;
  }

  const results = [];
  for (const contact of targets) {
    results.push(await notifyContact(user, alert, contact, nextLayer, isReminder));
  }

  alert.layer = nextLayer;
  alert.lastEscalatedAt = new Date();

  // Atomic updates, so an "I'm responding" tap that lands while messages are
  // being sent is never overwritten by a full-document save.
  const added = results.filter((r) => r.isNew).map((r) => r.entry);
  await Alert.updateOne(
    { _id: alert._id },
    {
      $set: { layer: alert.layer, lastEscalatedAt: alert.lastEscalatedAt },
      ...(added.length ? { $push: { notifications: { $each: added } } } : {}),
    }
  );
  for (const { entry } of results.filter((r) => !r.isNew)) {
    await Alert.updateOne(
      { _id: alert._id, "notifications.key": entry.key },
      { $set: { "notifications.$.email": entry.email, "notifications.$.sms": entry.sms, "notifications.$.sentAt": entry.sentAt } }
    );
  }
  return true;
};

const startAlert = async (userId, location) => {
  const alert = await Alert.create({
    userId,
    shareToken: randomToken(16),
    startLocation: location || null,
    path: location ? [location] : [],
  });
  await escalate(alert);
  return alert;
};

const sendSafeMessage = async (alert, outcome) => {
  const user = await User.findById(alert.userId);
  if (!user) return;
  const name = `${user.firstName} ${user.lastName}`;
  const reason = outcome === "cancelled" ? "The alert was a false alarm." : `${user.firstName} has marked themselves safe.`;
  const text = `Update from SheShield: ${name}'s SOS alert has ended. ${reason} Thank you for being there.`;

  const contacts = await Contact.find({ _id: { $in: alert.notifications.map((n) => n.contactId) } });
  await Promise.all(
    contacts.map((contact) =>
      Promise.all([
        sendEmail({
          to: contact.email,
          subject: `${name} is safe`,
          text,
          html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:22px;border:1px solid #c9eedb;border-radius:16px">
            <div style="font-size:22px;font-weight:bold;color:#15965d">${escapeHtml(name)} is safe</div>
            <p style="color:#22151c;line-height:1.6">${escapeHtml(text)}</p></div>`,
        }),
        sendSMS({ to: contact.phone, body: text }),
      ])
    )
  );
};

const endAlert = async (alert, outcome) => {
  alert.status = outcome === "cancelled" ? "cancelled" : "resolved";
  alert.endedAt = new Date();
  await Alert.updateOne({ _id: alert._id }, { $set: { status: alert.status, endedAt: alert.endedAt } });
  if (alert.notifications.length) await sendSafeMessage(alert, alert.status);
  return alert;
};

// Runs periodically: escalates unanswered alerts and closes stale ones.
let sweeping = false;
const sweep = async () => {
  if (sweeping) return;
  sweeping = true;
  try {
    const now = Date.now();

    const stale = await Alert.find({ status: "active", createdAt: { $lte: new Date(now - ALERT_MAX_AGE_MS) } });
    if (stale.length) {
      await Alert.updateMany(
        { _id: { $in: stale.map((a) => a._id) }, status: "active" },
        { $set: { status: "resolved", endedAt: new Date() } }
      );
    }

    const due = await Alert.find({
      status: "active",
      acknowledgedBy: null,
      escalationDone: false,
      lastEscalatedAt: { $lte: new Date(now - escalationInterval() * 1000) },
    });

    for (const alert of due) {
      const escalated = await escalate(alert);
      if (!escalated) await Alert.updateOne({ _id: alert._id }, { $set: { escalationDone: true } });
    }
  } catch (error) {
    console.error("SOS escalation sweep failed:", error.message);
  } finally {
    sweeping = false;
  }
};

const startScheduler = () => setInterval(sweep, 10 * 1000);

module.exports = { startAlert, endAlert, escalate, sweep, startScheduler, priorityGroups };
