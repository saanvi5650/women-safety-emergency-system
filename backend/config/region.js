// SheShield currently serves India only. Rough bounding box of India
// (keep in sync with INDIA_BOUNDS in frontend/js/app.js).
const INDIA_BOUNDS = { south: 6.0, west: 67.5, north: 37.5, east: 98.0 };

const inServiceArea = (lat, lng) =>
  lat >= INDIA_BOUNDS.south && lat <= INDIA_BOUNDS.north && lng >= INDIA_BOUNDS.west && lng <= INDIA_BOUNDS.east;

module.exports = { INDIA_BOUNDS, inServiceArea };
