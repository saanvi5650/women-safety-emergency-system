// Adds clearly-labelled sample danger reports around a city centre so the
// Safety Map has something to show during demos.
//
//   npm run seed:demo                     -> around Chennai
//   npm run seed:demo -- 28.6139 77.2090  -> around another lat/lng
//   npm run seed:demo -- --clear          -> remove all demo reports

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
const mongoose = require("mongoose");
const Report = require("../models/report");
const User = require("../models/user");
const { inServiceArea } = require("../config/region");

const SAMPLES = [
  ["poor_lighting", 2, "Street lights not working along this stretch after 8 PM"],
  ["harassment", 3, "Group of men passing comments near the bus stop"],
  ["deserted", 2, "Very empty underpass late at night"],
  ["unsafe_transport", 2, "Share autos here overcrowded, felt unsafe"],
  ["stalking", 3, "Was followed from the station for two blocks"],
  ["theft", 2, "Phone snatching reported near the signal"],
  ["poor_lighting", 1, "Dim lane, CCTV not visible"],
  ["harassment", 2, "Catcalling outside the tea shop in the evenings"],
  ["deserted", 1, "Park entrance isolated after closing time"],
  ["other", 1, "Broken footpath forces walking on the road"],
];

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI);

  if (process.argv.includes("--clear")) {
    const { deletedCount } = await Report.deleteMany({ demo: true });
    console.log(`Removed ${deletedCount} demo reports`);
    return mongoose.disconnect();
  }

  const [lat = 13.0827, lng = 80.2707] = process.argv.slice(2).map(Number);
  if (!inServiceArea(lat, lng)) {
    console.error("Demo data can only be added inside India.");
    return mongoose.disconnect();
  }
  const owner = await User.findOne();
  if (!owner) {
    console.error("Create an account first, then run the seed again.");
    return mongoose.disconnect();
  }

  const docs = [];
  for (let i = 0; i < 40; i++) {
    const [category, severity, description] = SAMPLES[i % SAMPLES.length];
    const angle = Math.random() * 2 * Math.PI;
    const dist = Math.random() * 0.045; // roughly within 5 km
    const occurredAt = new Date(Date.now() - Math.random() * 120 * 24 * 3600 * 1000);
    occurredAt.setHours(Math.random() < 0.65 ? 19 + Math.floor(Math.random() * 5) : 8 + Math.floor(Math.random() * 10));
    docs.push({
      reportedBy: owner._id,
      location: { type: "Point", coordinates: [lng + dist * Math.cos(angle), lat + dist * Math.sin(angle)] },
      category,
      severity,
      description,
      occurredAt,
      demo: true,
    });
  }

  await Report.insertMany(docs);
  console.log(`Added ${docs.length} demo reports around ${lat}, ${lng}`);
  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
