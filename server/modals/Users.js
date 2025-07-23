const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true, // ✅ fixed typo
  },
  email: {
    type: String,
    required: true,
    unique: true,
  },
  password: {
    type: String,
    required: true,
  },
  roomId: {
    type: [String], // ✅ array of strings
    default: [], // ✅ initially empty
  },
});

const User = mongoose.model("User", userSchema);

module.exports = User;
