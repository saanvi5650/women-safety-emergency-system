const mongoose = require("mongoose");

let connection = null;

const connectDB = async () => {
  if (connection) return connection;

  try {
    connection = await mongoose.connect(process.env.MONGO_URI);
    console.log("MongoDB connected successfully");
    return connection;
  } catch (error) {
    connection = null;
    console.error("Database connection failed:", error.message);
    throw error;
  }
};

module.exports = connectDB;
