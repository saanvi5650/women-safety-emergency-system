const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const User = require("../models/user");
const Contact = require("../models/contact");
const requireAuth = require("../middleware/auth");

const router = express.Router();

// Slow down password guessing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts, please try again in a few minutes" },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const signToken = (user) =>
  jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });

router.post("/signup", authLimiter, async (req, res) => {
  try {
    // Coerce to strings so JSON objects can't become query operators.
    const [firstName, lastName, phone, password, quickContact] = ["firstName", "lastName", "phone", "password", "quickContact"].map(
      (key) => (req.body[key] === undefined || req.body[key] === null ? "" : String(req.body[key]).trim())
    );
    const email = String(req.body.email || "").trim().toLowerCase();

    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "Please enter a valid email address" });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: "Password must be at least 8 characters" });
    }

    const existingUser = await User.findOne({
      $or: [{ email }, { phone }]
    });

    if (existingUser) {
      return res.status(400).json({ message: "An account with this email or phone already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      firstName,
      lastName,
      email,
      phone,
      password: hashedPassword
    });

    // The optional emergency number from the signup form becomes the first trusted contact.
    if (quickContact) {
      await Contact.create({
        userId: user._id,
        name: "Emergency Contact",
        relationship: "Guardian",
        phone: quickContact,
        priority: 1
      });
    }

    res.status(201).json({
      message: "Account created successfully",
      token: signToken(user),
      user: user.toPublic()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/login", authLimiter, async (req, res) => {
  try {
    const password = String(req.body.password || "");
    const emailOrPhone = String(req.body.emailOrPhone || "").trim();

    if (!emailOrPhone || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const user = await User.findOne({
      $or: [{ email: emailOrPhone.toLowerCase() }, { phone: emailOrPhone }]
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    res.status(200).json({
      message: "Login successful",
      token: signToken(user),
      user: user.toPublic()
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(user.toPublic());
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.put("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const { firstName, lastName, phone, medicalNotes, settings } = req.body;

    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (medicalNotes !== undefined) user.medicalNotes = medicalNotes;

    const newPhone = typeof phone === "string" ? phone.trim() : "";
    if (newPhone && newPhone !== user.phone) {
      const taken = await User.exists({ phone: newPhone, _id: { $ne: user._id } });
      if (taken) return res.status(400).json({ message: "This phone number is already in use" });
      user.phone = newPhone;
    }

    if (settings) {
      if (settings.countdownSeconds !== undefined) {
        user.settings.countdownSeconds = Number(settings.countdownSeconds);
      }
      if (settings.shareLiveLocation !== undefined) {
        user.settings.shareLiveLocation = Boolean(settings.shareLiveLocation);
      }
    }

    await user.save();
    res.status(200).json({ message: "Profile updated", user: user.toPublic() });
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

module.exports = router;
