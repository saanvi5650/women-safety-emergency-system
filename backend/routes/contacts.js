const express = require("express");
const mongoose = require("mongoose");
const Contact = require("../models/contact");
const requireAuth = require("../middleware/auth");

const router = express.Router();

const MAX_CONTACTS = 10;

// Every route is scoped to the logged-in user, so nobody can read or edit someone else's contacts.
router.use(requireAuth);

const pickFields = (body) => {
  const fields = {};
  for (const key of ["name", "relationship", "phone", "email", "priority"]) {
    if (body[key] !== undefined) fields[key] = body[key];
  }
  return fields;
};

router.get("/", async (req, res) => {
  try {
    const contacts = await Contact.find({ userId: req.user.id }).sort({
      priority: 1,
      createdAt: 1
    });

    res.status(200).json(contacts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, relationship, phone, priority } = req.body;

    if (!name || !relationship || !phone || !priority) {
      return res.status(400).json({ message: "Required fields missing" });
    }

    const count = await Contact.countDocuments({ userId: req.user.id });
    if (count >= MAX_CONTACTS) {
      return res.status(400).json({ message: `You can add up to ${MAX_CONTACTS} trusted contacts` });
    }

    const contact = await Contact.create({ ...pickFields(req.body), userId: req.user.id });

    res.status(201).json({
      message: "Contact added successfully",
      contact
    });
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Contact not found" });
    }

    const contact = await Contact.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      pickFields(req.body),
      { returnDocument: "after", runValidators: true }
    );

    if (!contact) return res.status(404).json({ message: "Contact not found" });

    res.status(200).json({ message: "Contact updated", contact });
  } catch (error) {
    const status = error.name === "ValidationError" ? 400 : 500;
    res.status(status).json({ message: error.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: "Contact not found" });
    }

    const result = await Contact.deleteOne({ _id: req.params.id, userId: req.user.id });
    if (!result.deletedCount) return res.status(404).json({ message: "Contact not found" });

    res.status(200).json({ message: "Contact removed" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
