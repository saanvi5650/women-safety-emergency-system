const mongoose = require("mongoose");

const CATEGORIES = [
  "harassment",
  "stalking",
  "poor_lighting",
  "deserted",
  "unsafe_transport",
  "theft",
  "assault",
  "other",
];

const reportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // GeoJSON point: coordinates are [longitude, latitude].
    location: {
      type: { type: String, enum: ["Point"], default: "Point" },
      coordinates: { type: [Number], required: true },
    },
    category: { type: String, enum: CATEGORIES, required: true },
    severity: { type: Number, min: 1, max: 3, default: 2 },
    description: { type: String, default: "", trim: true, maxlength: 400 },
    // When the incident happened, so the map can weigh night-time reports.
    occurredAt: { type: Date, default: Date.now },
    confirmations: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    demo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

reportSchema.index({ location: "2dsphere" });

reportSchema.methods.toPublic = function (viewerId) {
  return {
    id: this._id,
    lat: this.location.coordinates[1],
    lng: this.location.coordinates[0],
    category: this.category,
    severity: this.severity,
    description: this.description,
    occurredAt: this.occurredAt,
    confirmations: this.confirmations.length,
    confirmedByMe: viewerId ? this.confirmations.some((id) => id.equals(viewerId)) : false,
    mine: viewerId ? this.reportedBy.equals(viewerId) : false,
    demo: this.demo,
  };
};

module.exports = mongoose.model("Report", reportSchema);
module.exports.CATEGORIES = CATEGORIES;
