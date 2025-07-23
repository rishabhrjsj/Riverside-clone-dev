const express = require("express");
const router = express.Router();
const User = require("../modals/Users.js");
const bcrypt = require("bcrypt");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const authenticateUser = require("../Middleware/AuthMiddleware");

router.post("/register", async (req, res) => {
  const { name, email, password } = req.body;

  try {
    if (name && email && password) {
      const hashPassword = await bcrypt.hash(password, 10);
      const newUser = new User({ name, email, password: hashPassword });
      await newUser.save();

      console.log(`new user created: ${newUser.name}`);

      res.status(200).json({
        success: true,
        message: "New user created successfully",
        user: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
        },
      });
    } else {
      console.log(
        `Missing field: name=${name}, email=${email}, password=${password}`
      );
      res.status(400).json({
        success: false,
        message: "Missing fields",
      });
    }
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});

//login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // ✅ 1. Find user
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // ✅ 2. Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    // ✅ 3. Create JWT
    const payload = {
      id: user._id,
      name: user.name,
      email: user.email,
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: "1d",
    });

    // ✅ 4. Set cookie and send response
    res
      .cookie("token", token, {
        httpOnly: true,
        secure: false, // set to true in production (HTTPS)
        sameSite: "strict",
        maxAge: 24 * 60 * 60 * 1000,
      })
      .status(200)
      .json({
        success: true,
        message: "User Logged In",
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
        },
      });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

//logout
router.get("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: false, // should be true in production (HTTPS)
    sameSite: "strict",
  });

  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// for refreshing app
router.get("/profile", (req, res) => {
  const token = req.cookies.token;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return res.status(200).json({
      id: decoded.id,
      name: decoded.name,
      email: decoded.email,
    });
  } catch (err) {
    return res.status(401).json({ message: "Invalid token" });
  }
});

//setroomid
router.post("/setroom/:userId", authenticateUser, async (req, res) => {
  const { roomId } = req.body;
  const { userId } = req.params;

  try {
    if (roomId) {
      const updatedUser = await User.findByIdAndUpdate(
        userId,
        { $push: { roomId: roomId } },
        { new: true } // Return updated user
      );
      console.log("updated user", updatedUser);
      res.status(200).json({
        success: true,
        message: "roomId is set",
        user: {
          id: updatedUser._id,
          roomId: updatedUser.roomId,
        },
      });
    } else {
      res.status(400).json({
        success: false,
        message: "RoomId is empty",
      });
    }
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// GET /api/users/:userId/room-ids
router.get("/:userId/room-ids", authenticateUser, async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).select("roomId");
    console.log(user.roomId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      roomIds: user.roomId || [],
    });
  } catch (error) {
    console.error("Error fetching roomIds:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

module.exports = router;
