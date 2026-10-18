const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    // Shared with trusted contacts during an SOS (blood group, allergies, etc.)
    medicalNotes: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    settings: {
      countdownSeconds: { type: Number, default: 10, min: 3, max: 30 },
      shareLiveLocation: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

userSchema.methods.toPublic = function () {
  return {
    id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    phone: this.phone,
    medicalNotes: this.medicalNotes,
    settings: this.settings,
  };
};

module.exports = mongoose.model("User", userSchema);
