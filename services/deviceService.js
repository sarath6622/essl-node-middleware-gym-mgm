const ZKLib = require("zkteco-js");
const DEVICE_CONFIG = require("../config/deviceConfig");
const log = require("../utils/logger");
const { saveAttendanceRecord } = require("./firestoreService");
const { getUserByBiometricId } = require("./userService");
const { getDateInTimezone } = require("../utils/dateUtils");
const { retryWithBackoff, CircuitBreaker } = require("../utils/retryHelper");
const offlineStorage = require("./offlineStorage");
const EventEmitter = require("events");

// Increase default max listeners globally to prevent warnings
EventEmitter.defaultMaxListeners = 100;

let zk = null;
let isConnected = false;
let pollingInterval = null;
let lastLogCount = 0;
let isInitialSync = true; // Flag to track initial sync
let realtimeListenerSetup = false;
let lastRealtimeEventTime = null;
let realtimeFailureCount = 0;

// Circuit breaker for device connections
const deviceCircuitBreaker = new CircuitBreaker({
  failureThreshold: 3,
  resetTimeout: 30000, // 30 seconds
  operationName: "Device Connection",
});

// Polling configuration
const POLLING_INTERVAL = 10000; // 10 seconds
const REALTIME_TIMEOUT = 60000; // If no real-time event in 60s, assume failure (increased from 30s)
const MAX_REALTIME_FAILURES = 3; // After 3 failures, switch to polling mode
let permanentPollingMode = false; // Once we switch to polling, stay there

// Helper to process and enrich attendance data
async function processAndSaveRecord(rawRecord, source, io) {
  const now = new Date();
  const timestamp = rawRecord.timestamp || rawRecord.recordTime || rawRecord.record_time || now.toISOString();

  // Handle both userId and user_id (device sends user_id in snake_case)
  const userId = rawRecord.userId ?? rawRecord.user_id;

  // Validate userId exists
  if (userId === undefined && userId !== 0) {
    log("warning", `⚠️ Invalid attendance event - no userId provided`, rawRecord);
    return; // Skip invalid events
  }

  const biometricId = String(userId);
  const startTime = Date.now();

  // Immediately emit a "processing" event for instant UI feedback
  io.emit("attendance_processing", {
    biometricDeviceId: biometricId,
    timestamp: timestamp,
    status: "processing"
  });

  // Query user by biometricDeviceId (async operation)
  const userDetails = await getUserByBiometricId(biometricId);
  const lookupTime = Date.now() - startTime;

  let attendanceRecord;

  // If user not found, create record with unknown user
  if (!userDetails) {
    log("warning", `⚠️ Unknown user - biometricDeviceId: ${biometricId} (not in database)`);

    // Still create and emit event for UI display
    attendanceRecord = {
      userId: `unknown_${biometricId}`,
      name: `Unknown User (ID: ${biometricId})`,
      profileImageUrl: "",
      biometricDeviceId: biometricId,
      checkInTime: timestamp,
      checkOutTime: null,
      date: getDateInTimezone(timestamp, DEVICE_CONFIG.timezone),
      status: "present",
      source: "essl",
      membershipPlanId: null,
      membershipStatus: "unknown",
      membershipEndDate: null,
      remarks: `Entry from ${source} - User not found in database`,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    log("event", `📥 Attendance event for unknown user: ${biometricId}`, attendanceRecord);

    // Emit to UI immediately
    io.emit("attendance_event", attendanceRecord);
    return;
  }

  // User found - create full record
  attendanceRecord = {
    userId: userDetails.id, // Use the Firestore document ID as userId
    name: userDetails.name,
    profileImageUrl: userDetails.profileImageUrl || "",
    biometricDeviceId: userDetails.biometricDeviceId,
    checkInTime: timestamp,
    checkOutTime: null,
    date: getDateInTimezone(timestamp, DEVICE_CONFIG.timezone),
    status: "present",
    source: "essl",
    membershipPlanId: userDetails.membershipPlanId || null,
    membershipStatus: userDetails.membershipStatus || "inactive",
    membershipEndDate: userDetails.membershipEnd || null,
    remarks: `Entry recorded from ${source}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  const totalTime = Date.now() - startTime;
  log("event", `✅ Processed attendance for ${attendanceRecord.name} (lookup: ${lookupTime}ms, total: ${totalTime}ms)`);

  // Emit to UI immediately (don't wait for Firestore save)
  io.emit("attendance_event", attendanceRecord);

  // Save to Firestore in background (don't await)
  saveAttendanceRecord(attendanceRecord).catch(async err => {
    log("error", `Failed to save attendance to Firestore for ${attendanceRecord.name}:`, err.message);
    log("warning", `💾 Saving to offline storage...`);

    // Save to offline storage when Firebase is unavailable
    const offlineSaved = await offlineStorage.saveOfflineAttendance(attendanceRecord);

    if (offlineSaved) {
      // Emit offline event so UI can show offline indicator
      io.emit("attendance_saved_offline", {
        userId: attendanceRecord.userId,
        name: attendanceRecord.name,
        timestamp: attendanceRecord.checkInTime
      });
    } else {
      // Emit error event if both Firebase and offline storage failed
      io.emit("attendance_save_failed", {
        userId: attendanceRecord.userId,
        name: attendanceRecord.name,
        error: err.message
      });
    }
  });
}

/**
 * Core connection logic (without retry)
 */
async function connectToDeviceCore(io) {
  log("info", `Attempting to connect to eSSL K30 Pro at ${DEVICE_CONFIG.ip}:${DEVICE_CONFIG.port}...`);

  zk = new ZKLib(
    DEVICE_CONFIG.ip,
    DEVICE_CONFIG.port,
    DEVICE_CONFIG.timeout,
    DEVICE_CONFIG.inactivityTimeout
  );

  // Create socket with timeout
  const createSocketPromise = zk.createSocket();
  const socketTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Socket creation timeout')), 10000)
  );

  await Promise.race([createSocketPromise, socketTimeout]);

  // Increase max listeners to prevent warnings (must be done IMMEDIATELY after socket creation)
  if (zk.socket && zk.socket.setMaxListeners) {
    zk.socket.setMaxListeners(100); // Increased to 100 to prevent warnings
  }

  log("success", "✅ Successfully connected to eSSL K30 Pro!");
  isConnected = true;

  // Try to get device info with timeout
  try {
    const infoPromise = zk.getInfo();
    const infoTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Device info timeout')), 5000)
    );

    const deviceInfo = await Promise.race([infoPromise, infoTimeout]);
    log("success", "📋 Device information retrieved:", deviceInfo);
  } catch (infoErr) {
    log("warning", `⚠️ Could not retrieve device info: ${infoErr.message}`);
    log("info", "Continuing without device info...");
  }

  // Try to enable device with timeout
  try {
    const enablePromise = zk.enableDevice();
    const enableTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Enable device timeout')), 5000)
    );

    await Promise.race([enablePromise, enableTimeout]);
    log("success", "✅ Device real-time mode enabled");
  } catch (err) {
    log("warning", `⚠️ Could not enable device: ${err.message}`);
    log("info", "Device might already be enabled, continuing...");
  }

  setupRealtimeListener(io);
  io.emit("device_status", {
    connected: true,
    deviceIp: DEVICE_CONFIG.ip,
    timestamp: new Date().toISOString(),
  });

  return true;
}

/**
 * Connect to device with retry logic and circuit breaker
 */
async function connectToDevice(io, useRetry = true) {
  if (!useRetry) {
    // Direct connection without retry
    try {
      return await connectToDeviceCore(io);
    } catch (err) {
      isConnected = false;
      log("error", "Failed to connect to device", {
        error: err.message,
        code: err.code || err.err?.code,
      });
      return false;
    }
  }

  // Connection with retry and circuit breaker
  try {
    await deviceCircuitBreaker.execute(async () => {
      await retryWithBackoff(
        async () => {
          return await connectToDeviceCore(io);
        },
        {
          maxAttempts: 3,
          baseDelay: 2000, // Start with 2 seconds
          maxDelay: 10000, // Max 10 seconds
          operationName: "Device Connection",
          shouldRetry: (error) => {
            // Retry on network errors, timeout, connection refused
            const retryableErrors = ["ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"];
            const errorCode = error.code || error.err?.code;
            const errorMessage = error.message || error.toString() || "";
            return retryableErrors.includes(errorCode) || errorMessage.includes("timeout");
          },
          onRetry: (attempt, error, delay) => {
            io.emit("device_status", {
              connected: false,
              deviceIp: DEVICE_CONFIG.ip,
              retrying: true,
              attempt: attempt + 1,
              nextRetryIn: Math.round(delay / 1000),
            });
          },
        }
      );
    });

    return true;
  } catch (err) {
    isConnected = false;

    // Check circuit breaker state
    const cbState = deviceCircuitBreaker.getState();
    if (cbState.state === "OPEN") {
      log(
        "error",
        "Device connection circuit breaker is OPEN. Too many failures. Will retry automatically in 30s."
      );
    }

    log("error", "Failed to connect to device after all retry attempts", {
      error: err.message,
      code: err.code || err.err?.code,
    });

    io.emit("device_status", {
      connected: false,
      deviceIp: DEVICE_CONFIG.ip,
      error: err.message,
      timestamp: new Date().toISOString(),
    });

    return false;
  }
}

function setupRealtimeListener(io) {
  if (!zk) {
    log("error", "Cannot setup listener - device not connected");
    return;
  }

  // Prevent setting up multiple listeners
  if (realtimeListenerSetup) {
    log("debug", "Real-time listener already set up, skipping...");
    return;
  }

  log("info", "Setting up real-time attendance listener...");
  try {
    // Increase max listeners to prevent warnings (should already be set, but ensure it's high enough)
    const socket = zk.socket;
    if (socket && socket.setMaxListeners) {
      socket.setMaxListeners(100);
    }

    // Wrap getRealTimeLogs in a try-catch to handle errors gracefully
    try {
      zk.getRealTimeLogs(async (data) => {
        // Log full raw data for debugging
        console.log("📥 Raw device data:", JSON.stringify(data));

        // Update last event time for ALL events (including failed scans, heartbeats, etc.)
        // This prevents false "no real-time events" warnings
        lastRealtimeEventTime = Date.now();
        realtimeFailureCount = 0; // Reset on any event

        // Check if this is an attendance event (has userId or user_id)
        const hasUserId = data && (data.userId !== undefined || data.user_id !== undefined);

        if (hasUserId) {
          const userId = data.userId ?? data.user_id;

          // Check for failed/unrecognized fingerprint (userId is often 0 or -1 for failed scans)
          if (userId === 0 || userId === -1 || userId === "0" || userId === "-1") {
            log("warning", "❌ Fingerprint not recognized - scan failed");
            io.emit("fingerprint_failed", {
              timestamp: new Date().toISOString(),
              message: "Fingerprint not recognized"
            });
            return;
          }

          log("event", "🎯 Processing attendance event - User ID:", userId);
          await processAndSaveRecord(data, "essl-realtime", io);
        } else {
          // Skip non-attendance events (heartbeats, device status, etc.)
          // But we still updated lastRealtimeEventTime above to show real-time is working
          log("debug", "Skipping non-attendance event (heartbeat/status)");
        }
      });
    } catch (realtimeError) {
      log("error", `Failed to setup real-time logs: ${realtimeError.message}`);
      // Don't throw - connection was successful, just real-time monitoring failed
      log("warning", "Device connected but real-time monitoring unavailable");
      log("info", "You can still manually pull attendance records");
    }

    realtimeListenerSetup = true;
    lastRealtimeEventTime = Date.now(); // Initialize
    log("success", "Real-time listener activated");
  } catch (err) {
    log("error", "Failed to setup real-time listener:", err.message);
    realtimeFailureCount++;
  }
}

async function pollAttendanceLogs(io) {
  if (!isConnected || !zk) return;

  try {
    const logs = await zk.getAttendances();

    // On initial sync, just set the count and skip processing old logs
    if (isInitialSync) {
      lastLogCount = logs.data.length;
      isInitialSync = false;
      if (lastLogCount > 0) {
        log("info", `📚 Initial sync: ${lastLogCount} existing attendance records in device (not processing old records)`);
      }
      return;
    }

    // After initial sync, only process new logs
    if (logs.data.length > lastLogCount) {
      const newLogs = logs.data.slice(lastLogCount);
      log("event", `📥 New attendance logs detected (polling): ${newLogs.length} new records`);

      // Process all logs in parallel for better performance
      const processingPromises = newLogs.map(log_entry =>
        processAndSaveRecord(log_entry, "essl-polling", io).catch(err => {
          log("error", `Failed to process log entry for user ${log_entry.userId}:`, err.message);
          // Don't throw - let other logs continue processing
        })
      );

      await Promise.all(processingPromises);

      lastLogCount = logs.data.length;
    }
  } catch (err) {
    log("debug", "Polling error (normal if device is busy):", err.message);
  }
}

/**
 * Check if real-time events are working
 */
function isRealtimeWorking() {
  // If we've permanently switched to polling mode, real-time is not working
  if (permanentPollingMode) {
    return false;
  }

  if (!realtimeListenerSetup || !lastRealtimeEventTime) {
    return false;
  }

  const timeSinceLastEvent = Date.now() - lastRealtimeEventTime;
  return timeSinceLastEvent < REALTIME_TIMEOUT && realtimeFailureCount < MAX_REALTIME_FAILURES;
}

/**
 * Smart polling - only polls when real-time is failing
 */
async function smartPoll(io) {
  // Check if real-time is working
  if (isRealtimeWorking()) {
    // Real-time is working - skip polling
    return;
  }

  // Check if we should switch to permanent polling mode
  if (!permanentPollingMode && realtimeFailureCount >= MAX_REALTIME_FAILURES) {
    permanentPollingMode = true;
    log(
      "warning",
      `⚠️ Real-time events not detected after ${MAX_REALTIME_FAILURES} checks. Switching to permanent polling mode.`
    );
    log("info", "💡 This is normal for some device models or configurations. Polling will continue every 10 seconds.");
  }

  // Real-time might be failing - use polling as backup
  if (!permanentPollingMode && realtimeFailureCount < MAX_REALTIME_FAILURES) {
    const timeSinceLastEvent = Date.now() - (lastRealtimeEventTime || 0);
    if (timeSinceLastEvent > REALTIME_TIMEOUT) {
      realtimeFailureCount++;
      log(
        "warning",
        `No real-time events in ${Math.round(timeSinceLastEvent / 1000)}s. Using polling as backup (check ${realtimeFailureCount}/${MAX_REALTIME_FAILURES})`
      );
    }
  }

  // Poll for new logs
  await pollAttendanceLogs(io);
}

function startPolling(io, mode = "smart") {
  if (pollingInterval) return;

  if (mode === "smart") {
    log("info", "Starting smart polling (only activates when real-time fails)...");
    pollingInterval = setInterval(() => smartPoll(io), POLLING_INTERVAL);
  } else {
    // Legacy mode - always poll
    log("info", "Starting continuous polling (10-second intervals)...");
    pollingInterval = setInterval(() => pollAttendanceLogs(io), POLLING_INTERVAL);
  }
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    log("info", "Polling stopped");
  }
}

async function disconnectFromDevice() {
  if (isConnected && zk) {
    try {
      log("info", "Disconnecting from device...");
      
      // Remove all listeners first
      if (zk.socket) {
        zk.socket.removeAllListeners();
      }
      
      // Try graceful disconnect first
      try {
        await zk.disconnect();
      } catch (disconnectErr) {
        // If graceful disconnect fails, force destroy the socket
        if (zk.socket && !zk.socket.destroyed) {
          zk.socket.destroy();
        }
      }
      
      realtimeListenerSetup = false; // Reset flag for potential reconnection
      isConnected = false;
      zk = null;
      
      log("success", "Device disconnected successfully");
    } catch (err) {
      log("error", "Error disconnecting:", err.message);
      // Ensure cleanup even on error
      isConnected = false;
      zk = null;
    }
  }
}

/**
 * Get circuit breaker state
 */
function getCircuitBreakerState() {
  return deviceCircuitBreaker.getState();
}

/**
 * Reset circuit breaker (force allow connection attempts)
 */
function resetCircuitBreaker() {
  deviceCircuitBreaker.reset();
}

/**
 * Get polling stats
 */
function getPollingStats() {
  return {
    pollingActive: !!pollingInterval,
    realtimeActive: realtimeListenerSetup,
    realtimeWorking: isRealtimeWorking(),
    permanentPollingMode,
    lastRealtimeEventTime,
    timeSinceLastEvent: lastRealtimeEventTime ? Date.now() - lastRealtimeEventTime : null,
    realtimeFailureCount,
    maxFailures: MAX_REALTIME_FAILURES,
  };
}

module.exports = {
  connectToDevice,
  startPolling,
  stopPolling,
  disconnectFromDevice,
  getZkInstance: () => zk,
  isConnected: () => isConnected,
  getCircuitBreakerState,
  resetCircuitBreaker,
  getPollingStats,
};
