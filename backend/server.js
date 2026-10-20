const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api", (req, res) => {
  res.send("SheShield backend is running");
});

// Make sure MongoDB is connected before handling any request (needed on Vercel serverless)
app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (error) {
    res.status(500).json({ message: "Database connection failed" });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/contacts", require("./routes/contacts"));
app.use("/api/sos", require("./routes/sos"));

// Only start a server when running locally; on Vercel, api/index.js uses the exported app
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
