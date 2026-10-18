const mongoose = require("mongoose");

const pointSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true, min: -90, max: 90 },
    lng: { type: Number, required: true, min: -180, max: 180 },
    accuracy: { type: Number, default: null },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const notificationSchema = new mongoose.Schema(
  {
    contactId: { type: mongoose.Schema.Types.ObjectId, ref: "Contact" },
    name: String,
    layer: Number,
    // Secret per-contact key in the tracking link, used to acknowledge the alert.
    key: { type: String, required: true },
    email: { status: String, detail: String },
    sms: { status: String, detail: String },
    acknowledgedAt: { type: Date, default: null },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const alertSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "cancelled", "resolved"],
      default: "active",
      index: true,
    },
    // Public token for the read-only live tracking page.
    shareToken: { type: String, required: true, unique: true },
    layer: { type: Number, default: 0 },
    lastEscalatedAt: { type: Date, default: Date.now },
    escalationDone: { type: Boolean, default: false },
    startLocation: { type: pointSchema, default: null },
    path: { type: [pointSchema], default: [] },
    notifications: { type: [notificationSchema], default: [] },
    acknowledgedBy: { type: String, default: null },
    endedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// At most one active alert per user, even if SOS is pressed twice at once.
alertSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { status: "active" } });

alertSchema.virtual("lastLocation").get(function () {
  return this.path.length ? this.path[this.path.length - 1] : this.startLocation;
});

module.exports = mongoose.model("Alert", alertSchema);
