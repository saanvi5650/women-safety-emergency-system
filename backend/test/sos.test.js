const { test, beforeEach } = require("node:test");
const assert = require("node:assert");
const mongoose = require("mongoose");

process.env.JWT_SECRET = "test-secret";
delete process.env.SMTP_USER;
delete process.env.SMS_PROVIDER;

const Alert = require("../models/alert");
const Contact = require("../models/contact");
const User = require("../models/user");
const { escalate, priorityGroups } = require("../services/sos");

const user = new User({
  firstName: "Priya",
  lastName: "Sharma",
  email: "priya@example.com",
  phone: "+919876543210",
  password: "x",
});

const contact = (name, priority) =>
  new Contact({ userId: user._id, name, relationship: "Friend", phone: "+91900000000" + priority, priority });

let contacts;

beforeEach(() => {
  contacts = [contact("Mother", 1), contact("Father", 1), contact("Riya", 3), contact("Anu", 4)];
  User.findById = async () => user;
  Alert.updateOne = async () => ({ matchedCount: 1 });
  Contact.find = () => ({ sort: async () => contacts });
});

const newAlert = () => {
  const alert = new Alert({ userId: user._id, shareToken: "tok", startLocation: { lat: 13.08, lng: 80.27 } });
  return alert;
};

test("priorityGroups groups contacts by priority, skipping empty priorities", () => {
  const groups = priorityGroups(contacts);
  assert.deepStrictEqual(
    groups.map((g) => g.map((c) => c.name)),
    [["Mother", "Father"], ["Riya"], ["Anu"]]
  );
});

test("escalation walks through each priority group, then re-alerts, then stops", async () => {
  const alert = newAlert();

  assert.strictEqual(await escalate(alert), true);
  assert.strictEqual(alert.layer, 1);
  assert.deepStrictEqual(alert.notifications.map((n) => n.name), ["Mother", "Father"]);

  assert.strictEqual(await escalate(alert), true);
  assert.strictEqual(await escalate(alert), true);
  assert.strictEqual(alert.notifications.length, 4);

  // Final layer re-alerts everyone who has not acknowledged, without duplicating entries.
  alert.notifications[0].acknowledgedAt = new Date();
  const motherSentAt = alert.notifications[0].sentAt;
  assert.strictEqual(await escalate(alert), true);
  assert.strictEqual(alert.layer, 4);
  assert.strictEqual(alert.notifications.length, 4);
  assert.strictEqual(alert.notifications[0].sentAt, motherSentAt);

  assert.strictEqual(await escalate(alert), false);
});

test("unconfigured channels are reported as skipped, not failed", async () => {
  const alert = newAlert();
  await escalate(alert);
  const n = alert.notifications[0];
  assert.strictEqual(n.sms.status, "skipped");
  assert.strictEqual(n.email.status, "skipped");
  assert.match(n.key, /^[A-Za-z0-9_-]{8,}$/);
});

test("escalation with no contacts does nothing", async () => {
  contacts = [];
  const alert = newAlert();
  assert.strictEqual(await escalate(alert), false);
  assert.strictEqual(alert.layer, 0);
});

test("models compile without a database connection", () => {
  assert.strictEqual(mongoose.connection.readyState, 0);
});

test("escalation persists with atomic updates instead of saving the whole alert", async () => {
  const calls = [];
  Alert.updateOne = async (filter, update) => {
    calls.push({ filter, update });
    return { matchedCount: 1 };
  };
  const alert = newAlert();
  alert.save = async () => assert.fail("escalate must not call save()");

  await escalate(alert);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].update.$set.layer, 1);
  assert.strictEqual(calls[0].update.$push.notifications.$each.length, 2);

  // Reminder layer updates existing entries in place by key.
  await escalate(alert);
  await escalate(alert);
  calls.length = 0;
  await escalate(alert);
  const positional = calls.filter((c) => c.filter["notifications.key"]);
  assert.strictEqual(positional.length, 4);
  assert.ok(positional.every((c) => c.update.$set["notifications.$.sentAt"]));
});
