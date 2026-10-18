const { test } = require("node:test");
const assert = require("node:assert");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const request = require("supertest");

process.env.MONGO_URI = "mongodb://127.0.0.1:1/unused";
process.env.JWT_SECRET = "test-secret";
mongoose.set("bufferCommands", false);

const app = require("../server");

test("health endpoint reports channel status", async () => {
  const res = await request(app).get("/api/health");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.app, "SheShield");
  assert.deepStrictEqual(Object.keys(res.body.channels).sort(), ["email", "sms"]);
});

test("protected routes reject missing and invalid tokens", async () => {
  for (const [method, path] of [
    ["get", "/api/contacts"],
    ["post", "/api/sos/trigger"],
    ["get", "/api/sos/history"],
    ["get", "/api/reports?lat=13&lng=80"],
    ["get", "/api/auth/me"],
  ]) {
    const res = await request(app)[method](path);
    assert.strictEqual(res.status, 401, `${method} ${path}`);
  }

  const bad = await request(app).get("/api/contacts").set("Authorization", "Bearer nope");
  assert.strictEqual(bad.status, 401);
});

test("the old unauthenticated /api/contacts/:userId listing is gone", async () => {
  const res = await request(app).get("/api/contacts/64b7f0c2a1b2c3d4e5f60718");
  assert.strictEqual(res.status, 401);
});

test("input validation runs before touching the database", async () => {
  const token = jwt.sign({ id: new mongoose.Types.ObjectId() }, "test-secret");
  const auth = { Authorization: `Bearer ${token}` };

  const signup = await request(app).post("/api/auth/signup").send({ firstName: "A" });
  assert.strictEqual(signup.status, 400);

  const shortPass = await request(app)
    .post("/api/auth/signup")
    .send({ firstName: "A", lastName: "B", email: "a@b.co", phone: "1", password: "short" });
  assert.strictEqual(shortPass.status, 400);

  const badCoords = await request(app).get("/api/reports/score?lat=200&lng=0").set(auth);
  assert.strictEqual(badCoords.status, 400);

  const badCategory = await request(app).post("/api/reports").set(auth).send({ lat: 13, lng: 80, category: "x" });
  assert.strictEqual(badCategory.status, 400);

  const outsideIndia = await request(app).post("/api/reports").set(auth).send({ lat: 51.5, lng: -0.12, category: "theft" });
  assert.strictEqual(outsideIndia.status, 400);
  assert.match(outsideIndia.body.message, /India/);

  const badLocation = await request(app).post("/api/sos/64b7f0c2a1b2c3d4e5f60718/location").set(auth).send({ lat: "x" });
  assert.strictEqual(badLocation.status, 400);
});

test("frontend is served from the same origin", async () => {
  const index = await request(app).get("/");
  assert.strictEqual(index.status, 200);
  assert.match(index.text, /SheShield/);

  for (const page of ["/map.html", "/track.html", "/js/app.js"]) {
    const res = await request(app).get(page);
    assert.strictEqual(res.status, 200, page);
  }
});

test("unknown API routes return JSON 404", async () => {
  const res = await request(app).get("/api/nope");
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.message, "Not found");
});
