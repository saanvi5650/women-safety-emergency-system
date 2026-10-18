const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config({ path: path.join(__dirname, ".env"), quiet: true });

const missing = ["MONGO_URI", "JWT_SECRET"].filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(", ")}. Copy backend/.env.example to backend/.env and fill them in.`);
  process.exit(1);
}

const { startScheduler } = require("./services/sos");
const { channelStatus } = require("./services/notify");

const app = express();

app.set("trust proxy", 1);
app.use(cors(process.env.CORS_ORIGIN ? { origin: process.env.CORS_ORIGIN.split(",") } : undefined));
app.use(express.json({ limit: "100kb" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/contacts", require("./routes/contacts"));
app.use("/api/sos", require("./routes/sos"));
app.use("/api/reports", require("./routes/reports"));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "SheShield", channels: channelStatus() });
});

app.use("/api", (req, res) => {
  res.status(404).json({ message: "Not found" });
});

// Serve the frontend from the same origin so links like /track.html work for contacts.
app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = process.env.PORT || 5000;

const start = async () => {
  await connectDB();
  startScheduler();
  app.listen(PORT, () => {
    const channels = channelStatus();
    console.log(`SheShield running at http://localhost:${PORT}`);
    console.log(`Alert channels -> email: ${channels.email ? "on" : "off"}, sms: ${channels.sms ? "on" : "off"}`);
  });
};

if (require.main === module) start();

module.exports = app;
