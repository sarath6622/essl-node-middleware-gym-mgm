const express = require("express");
const log = require("../utils/logger");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// Middleware to get services from app context
const getServices = (req, res, next) => {
  req.deviceService = req.app.get("deviceService");
  next();
};

// Rate limiting - strict for write operations
const defaultLimiter = createRateLimiter("default"); // 60 req/min
const strictLimiter = createRateLimiter("strict");   // 10 req/min

router.use(getServices);

/**
 * Add a new user to the biometric device
 * POST /users/add
 * Body: { userId, name, password, role, cardNumber }
 */
router.post("/add", strictLimiter, async (req, res) => {
  const zkInstance = req.deviceService.getZkInstance();
  
  if (!req.deviceService.isConnected() || !zkInstance) {
    return res.status(503).json({
      error: "Device not connected",
    });
  }

  const { userId, name, password, role, cardNumber } = req.body;

  // Validate required fields
  if (!userId) {
    return res.status(400).json({
      error: "userId is required",
    });
  }

  try {
    log("info", `Adding new user to device: ${userId} (${name || "No name"})`);

    // Set user on device
    // Parameters: uid, userid, name, password, role, cardno
    await zkInstance.setUser(
      parseInt(userId),       // uid - unique user ID (number)
      userId.toString(),      // userid - user ID as string
      name || "",             // name - user's name
      password || "",         // password - optional password
      role || 0,              // role - 0=user, 14=admin
      cardNumber || 0         // cardno - card number if using RFID
    );

    log("success", `User ${userId} added successfully to biometric device`);

    res.json({
      success: true,
      message: `User ${userId} added to device`,
      user: {
        userId,
        name: name || "",
        role: role || 0,
      },
    });
  } catch (err) {
    log("error", `Failed to add user ${userId} to device:`, err.message);
    res.status(500).json({
      error: "Failed to add user",
      message: err.message,
    });
  }
});

/**
 * Get all users from the biometric device
 * GET /users
 */
router.get("/", defaultLimiter, async (req, res) => {
  const zkInstance = req.deviceService.getZkInstance();
  
  if (!req.deviceService.isConnected() || !zkInstance) {
    return res.status(503).json({
      error: "Device not connected",
    });
  }

  try {
    log("info", "Fetching all users from biometric device...");
    const users = await zkInstance.getUsers();
    log("success", `Retrieved ${users.data.length} users from device`);

    res.json({
      success: true,
      count: users.data.length,
      data: users.data.map((user) => ({
        uid: user.uid,
        userId: user.userId,
        name: user.name,
        role: user.role,
        password: user.password,
        cardNumber: user.cardno,
      })),
    });
  } catch (err) {
    log("error", "Failed to get users from device:", err.message);
    res.status(500).json({
      error: "Failed to retrieve users",
      message: err.message,
    });
  }
});

/**
 * Delete a user from the biometric device
 * DELETE /users/:userId
 */
router.delete("/:userId", strictLimiter, async (req, res) => {
  const zkInstance = req.deviceService.getZkInstance();
  
  if (!req.deviceService.isConnected() || !zkInstance) {
    return res.status(503).json({
      error: "Device not connected",
    });
  }

  const { userId } = req.params;

  try {
    log("info", `Deleting user from device: ${userId}`);

    // Delete user by UID
    await zkInstance.deleteUser(parseInt(userId));

    log("success", `User ${userId} deleted successfully from biometric device`);

    res.json({
      success: true,
      message: `User ${userId} deleted from device`,
    });
  } catch (err) {
    log("error", `Failed to delete user ${userId} from device:`, err.message);
    res.status(500).json({
      error: "Failed to delete user",
      message: err.message,
    });
  }
});

module.exports = router;
