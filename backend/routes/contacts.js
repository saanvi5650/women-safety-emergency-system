const express = require("express");
const Contact = require("../models/contact");

const router = express.Router();

router.post("/add", async (req, res) => {
  try {
    const { userId, name, relationship, phone, email, priority } = req.body;

    if (!userId || !name || !relationship || !phone || !priority) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    const contact = await Contact.create({
      userId,
      name,
      relationship,
      phone,
      email,
      priority
    });

    res.status(201).json({
      message: "Contact added successfully",
      contact
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get("/:userId", async (req, res) => {
  try {
    const contacts = await Contact.find({ userId: req.params.userId }).sort({
      priority: 1
    });

    res.status(200).json(contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;