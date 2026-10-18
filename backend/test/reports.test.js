const { test } = require("node:test");
const assert = require("node:assert");

process.env.JWT_SECRET = "test-secret";

const { safetyScore } = require("../routes/reports");

const report = (lat, lng, { severity = 2, daysAgo = 1, confirmations = 0, hour = 21 } = {}) => {
  const occurredAt = new Date(Date.UTC(2026, 9, 10) - daysAgo * 86400000);
  occurredAt.setHours(hour);
  return {
    location: { coordinates: [lng, lat] },
    severity,
    occurredAt,
    confirmations: Array.from({ length: confirmations }),
  };
};

const NOW_DAY = new Date(2026, 9, 10, 12);
const NOW_NIGHT = new Date(2026, 9, 10, 22);

test("no reports means a perfect score", () => {
  assert.deepStrictEqual(safetyScore([], 13, 80, 500, NOW_DAY), { score: 100, level: "safe", reports: 0 });
});

test("more and more severe reports lower the score", () => {
  const one = safetyScore([report(13, 80)], 13, 80, 500, NOW_DAY).score;
  const many = safetyScore([report(13, 80), report(13, 80, { severity: 3 }), report(13, 80)], 13, 80, 500, NOW_DAY).score;
  assert.ok(one < 100);
  assert.ok(many < one);
});

test("distant, old reports matter less than close, recent ones", () => {
  const close = safetyScore([report(13, 80)], 13, 80, 500, NOW_DAY).score;
  const far = safetyScore([report(13.004, 80)], 13, 80, 500, NOW_DAY).score;
  const old = safetyScore([report(13, 80, { daysAgo: 720 })], 13, 80, 500, NOW_DAY).score;
  assert.ok(far > close);
  assert.ok(old > close);
});

test("night-time reports weigh more at night", () => {
  const reports = [report(13, 80, { hour: 22 }), report(13, 80, { hour: 23, severity: 3 })];
  const day = safetyScore(reports, 13, 80, 500, NOW_DAY).score;
  const night = safetyScore(reports, 13, 80, 500, NOW_NIGHT).score;
  assert.ok(night < day);
});

test("confirmed reports weigh more", () => {
  const plain = safetyScore([report(13, 80)], 13, 80, 500, NOW_DAY).score;
  const confirmed = safetyScore([report(13, 80, { confirmations: 6 })], 13, 80, 500, NOW_DAY).score;
  assert.ok(confirmed < plain);
});
