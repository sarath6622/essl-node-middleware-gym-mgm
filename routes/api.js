const express = require("express");
const log = require("../utils/logger");
const { scanForDevices } = require("../utils/networkScanner");
const DEVICE_CONFIG = require("../config/deviceConfig");
const { createRateLimiter } = require("../middleware/rateLimiter");

const router = express.Router();

// Middleware to get services from app context
const getServices = (req, res, next) => {
  req.deviceService = req.app.get("deviceService");
  req.io = req.app.get("io");
  next();
};

// Rate limiting middleware
const defaultLimiter = createRateLimiter("default"); // 60 req/min
const strictLimiter = createRateLimiter("strict");   // 10 req/min for expensive ops
const looseLimiter = createRateLimiter("loose");     // 120 req/min for lightweight ops

router.use(getServices);

router.get("/health", looseLimiter, (req, res) => {
  res.json({
    status: "ok",
    server: "running",
    timestamp: new Date().toISOString(),
  });
});

router.get("/status", defaultLimiter, (req, res) => {
  const isMock = DEVICE_CONFIG.useMockDevice;
  res.json({
    connected: req.deviceService.isConnected(),
    deviceIp: isMock ? "mock-device" : DEVICE_CONFIG.ip,
    devicePort: isMock ? null : DEVICE_CONFIG.port,
    isMock,
    timestamp: new Date().toISOString(),
  });
});

router.get("/config", looseLimiter, (req, res) => {
  res.json({
    success: true,
    config: {
      useMockDevice: DEVICE_CONFIG.useMockDevice,
      autoDiscoverDevice: DEVICE_CONFIG.autoDiscoverDevice,
      ip: DEVICE_CONFIG.ip,
      port: DEVICE_CONFIG.port,
      timezone: DEVICE_CONFIG.timezone
    }
  });
});

router.post("/device/connect", strictLimiter, async (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ success: false, error: "IP address is required" });
  }

  log("info", `Manual connection request to ${ip}`);
  
  // Update config
  DEVICE_CONFIG.ip = ip;

  try {
    // Disconnect if connected
    if (req.deviceService.isConnected && req.deviceService.isConnected()) {
      await req.deviceService.disconnectFromDevice();
    }

    const linked = await req.deviceService.connectToDevice(req.io);
    
    if (linked && !DEVICE_CONFIG.useMockDevice) {
       // Initialize Firebase listener
       const { initializeMemberEnrollmentListener } = require("../services/memberEnrollmentService");
       initializeMemberEnrollmentListener(req.deviceService);
       
       // Start polling fallback
       setTimeout(() => {
         req.deviceService.startPolling(req.io);
       }, 10000);
    }

    res.json({ success: linked, connected: linked });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/reconnect", strictLimiter, async (req, res) => {
  log("info", "Manual reconnection triggered via API");
  const success = await req.deviceService.connectToDevice(req.io);
  res.json({
    success: success,
    connected: req.deviceService.isConnected(),
  });
});

router.get("/attendance/logs", strictLimiter, async (req, res) => {
  const { isConnected, getZkInstance } = req.deviceService;
  if (DEVICE_CONFIG.useMockDevice) {
    return res.json({ success: true, message: "Mock device does not store historical logs." });
  }

  if (!isConnected() || !getZkInstance()) {
    return res.status(503).json({ error: "Device not connected" });
  }

  try {
    log("info", "Fetching attendance logs via API...");
    const logs = await getZkInstance().getAttendances();
    log("success", `Retrieved ${logs.data.length} attendance records`);
    res.json({
      success: true,
      count: logs.data.length,
      data: logs.data.map((logEntry) => ({
        userId: logEntry.userId,
        timestamp: logEntry.timestamp,
        deviceUserId: logEntry.deviceUserId,
        recordTime: logEntry.recordTime,
      })),
    });
  } catch (err) {
    log("error", "Failed to get attendance logs:", err.message);
    res.status(500).json({ error: "Failed to retrieve attendance logs", message: err.message });
  }
});

router.get("/device/info", defaultLimiter, async (req, res) => {
  const { isConnected, getZkInstance } = req.deviceService;
  if (DEVICE_CONFIG.useMockDevice) {
    return res.json({ success: true, message: "Mock device has no specific device info.", data: { mock: true, model: 'MockDevice-v1' } });
  }

  if (!isConnected() || !getZkInstance()) {
    return res.status(503).json({ error: "Device not connected" });
  }

  try {
    const info = await getZkInstance().getInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    res.status(500).json({ error: "Failed to retrieve device information", message: err.message });
  }
});

router.get("/device/scan", strictLimiter, async (req, res) => {
  try {
    log("info", "Device scan triggered via API...");
    const devices = await scanForDevices(false);

    if (devices.length === 0) {
      log("warn", "No devices found during network scan");
      return res.json({
        success: true,
        count: 0,
        devices: [],
        message: "No fingerprint devices found on the network. Ensure device is powered on and connected to the same network."
      });
    }

    log("success", `Found ${devices.length} device(s) during scan`);
    res.json({
      success: true,
      count: devices.length,
      devices: devices,
      message: `Found ${devices.length} device(s) with port 4370 open`
    });
  } catch (err) {
    log("error", "Device scan failed:", err.message);
    res.status(500).json({
      success: false,
      error: "Device scan failed",
      message: err.message
    });
  }
});

router.post("/polling/start", defaultLimiter, (req, res) => {
  req.deviceService.startPolling(req.io);
  res.json({ success: true, message: "Polling started" });
});

router.post("/polling/stop", defaultLimiter, (req, res) => {
  req.deviceService.stopPolling();
  res.json({ success: true, message: "Polling stopped" });
});

router.get("/stats/offline", looseLimiter, async (req, res) => {
  try {
    const offlineStorage = require("../services/offlineStorage");
    const stats = await offlineStorage.getStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/sync/status", looseLimiter, async (req, res) => {
  try {
    const syncService = require("../services/syncService");
    const status = await syncService.getSyncStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/sync/force", strictLimiter, async (req, res) => {
  try {
    const syncService = require("../services/syncService");
    const result = await syncService.forceSyncNow(req.io);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Performance monitoring endpoints
router.get("/stats/performance", looseLimiter, (req, res) => {
  const { getCacheStats } = require("../services/userService");
  const { getBatchStats } = require("../services/firestoreService");
  const { getEnrollmentQueueStats } = require("../services/memberEnrollmentService");
  const { getRateLimiterStats } = require("../middleware/rateLimiter");

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    stats: {
      userCache: getCacheStats(),
      firestoreBatch: getBatchStats(),
      enrollmentQueue: getEnrollmentQueueStats(),
      rateLimiter: getRateLimiterStats(),
      polling: req.deviceService.getPollingStats(),
      circuitBreaker: req.deviceService.getCircuitBreakerState(),
    },
  });
});

// New comprehensive performance monitoring endpoint
router.get("/metrics/performance", looseLimiter, (req, res) => {
  const { getCacheStats } = require("../services/userService");
  const { getBatchStats } = require("../services/firestoreService");
  const { getEnrollmentQueueStats } = require("../services/memberEnrollmentService");
  const { getRateLimiterStats } = require("../middleware/rateLimiter");
  const { getMetrics } = require("../utils/performanceMonitor");

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    metrics: {
      // NEW: Attendance queue and event loop metrics
      performance: getMetrics(),
      attendanceQueue: req.deviceService.getAttendanceQueueStats(),

      // Existing metrics
      userCache: getCacheStats(),
      firestoreBatch: getBatchStats(),
      enrollmentQueue: getEnrollmentQueueStats(),
      rateLimiter: getRateLimiterStats(),
      polling: req.deviceService.getPollingStats(),
      circuitBreaker: req.deviceService.getCircuitBreakerState(),
    },
  });
});

// Manual cache refresh endpoint
router.post("/users/refresh-cache", strictLimiter, async (req, res) => {
  try {
    log("info", "Manual cache refresh triggered via API");
    const { prewarmCache, getCacheStats } = require("../services/userService");

    const startTime = Date.now();

    // Trigger cache refresh
    await prewarmCache();

    const duration = Date.now() - startTime;
    const stats = getCacheStats();

    log("success", `✅ Cache refresh completed in ${duration}ms - ${stats.validEntries} users loaded`);

    // Emit socket event to notify all connected clients
    if (req.io) {
      req.io.emit("cache_refreshed", {
        timestamp: new Date().toISOString(),
        usersLoaded: stats.validEntries,
        duration,
      });
    }

    res.json({
      success: true,
      message: "User cache refreshed successfully",
      stats: {
        usersLoaded: stats.validEntries,
        cacheSize: stats.totalEntries,
        duration,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    log("error", "Failed to refresh cache:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to refresh cache",
      message: error.message,
    });
  }
});

module.exports = router;

