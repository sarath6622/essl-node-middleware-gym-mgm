// Standalone Backend Server for Tauri Sidecar
const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');

const log = require('../utils/logger');
const { findFirstDevice } = require('../utils/networkScanner');
const initializeSocket = require('../services/socketService');
const apiRoutes = require('../routes/api');
const userManagementRoutes = require('../routes/userManagement');
const { initializeMemberEnrollmentListener } = require('../services/memberEnrollmentService');
const { prewarmCache } = require('../services/userService');
const syncService = require('../services/syncService');
const DEVICE_CONFIG = require('../config/deviceConfig');
const { getSettings, applySettingsToConfig } = require('../config/userSettings');

// Environment Setup
const PORT = process.env.PORT || 5001;

// Load and apply user settings at startup
try {
  const userSettings = getSettings();
  applySettingsToConfig(userSettings, DEVICE_CONFIG);
} catch (settingsErr) {
  log('warning', `Failed to load user settings: ${settingsErr.message}. Using defaults.`);
}

// Log startup
log('info', '🚀 Starting Backend Server (Sidecar Mode)...');
console.log('=== Backend Environment ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('CWD:', process.cwd());
console.log('==========================');

process.on('uncaughtException', (err) => {
  log('error', `CRITICAL UNCAUGHT EXCEPTION: ${err.message}`, err.stack);
  console.error('CRITICAL:', err);
  // Keep alive if possible? No, usually better to restart.
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', `UNHANDLED REJECTION: ${reason}`, reason);
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Self-termination when parent process (Tauri) exits
// The parent process holds a pipe to our stdin. When it dies, the pipe closes.
// WARN: In production sidecar mode, stdin might be closed immediately if not piped!
// Tauri handles sidecar cleanup automatically, so we might not need this for binary.
/*
process.stdin.resume();
process.stdin.on('end', () => {
    log('info', 'Parent process (Tauri) disconnected. Shutting down backend...');
    stopServer().then(() => process.exit(0));
});
*/

// Express server setup
const app = express();
const httpServer = http.createServer(app);

// Global state
let io = null;
let deviceService = null;
let server = null;

async function startServer() {
  return new Promise((resolve) => {
    // Explicitly require services for pkg detection with error handling
    let mockService, realService;
    try {
      mockService = require('./mockDeviceService');
    } catch (e) {
      log('error', `Failed to load Mock Service: ${e.message}`);
    }

    try {
      realService = require('./deviceService');
    } catch (e) {
      log('error', `Failed to load Real Device Service: ${e.message}`);
      // Fallback to avoid crash if real service is corrupt
      if (!mockService) process.exit(1);
    }

    // Initialize device service based on config
    // Safety check: if realService failed to load, forced fallback or error?
    if (!DEVICE_CONFIG.useMockDevice && !realService) {
      log('error', 'Critical: Real device service requested but failed to load.');
      // Don't crash, maybe fallback to mock or null? 
      // Better to let it fail or invalid state than silent mock?
      // Let's set it to null and handle checking later?
      deviceService = mockService; // Emergency fallback
      DEVICE_CONFIG.useMockDevice = true; // Switch mode
    } else {
      deviceService = DEVICE_CONFIG.useMockDevice ? mockService : realService;
    }

    // Initialize Socket.IO
    io = initializeSocket(httpServer);

    // ==========================================
    // AUTO-SHUTDOWN MECHANISM (Heartbeat)
    // ==========================================
    let shutdownTimer = null;

    function startShutdownTimer(delay = 5000) {
      if (shutdownTimer) clearTimeout(shutdownTimer);
      // Only log if meaningful (not just resetting)
      if (delay > 10000) log('info', `⏰ Starting initial shutdown timer (${delay / 1000}s) - waiting for UI...`);

      shutdownTimer = setTimeout(() => {
        log('warning', '⏰ No active clients for 5 seconds. Shutting down server.');
        stopServer().then(() => process.exit(0));
      }, delay);
    }

    function stopShutdownTimer() {
      if (shutdownTimer) {
        clearTimeout(shutdownTimer);
        shutdownTimer = null;
        // log('debug', '⏰ Client connected. Shutdown timer cancelled.');
      }
    }

    // Monitor connections
    io.on('connection', (socket) => {
      stopShutdownTimer();

      socket.on('disconnect', () => {
        // Check counts after a brief delay to allow for reloads/reconnects
        setTimeout(() => {
          if (!io || !io.engine) return;
          const count = io.engine.clientsCount;
          if (count === 0) {
            startShutdownTimer(5000); // 5 seconds grace period
          }
        }, 1000); // 1 second buffer
      });
    });

    // Start initial keep-alive timer (30s to allow app to launch)
    startShutdownTimer(30000);
    // ==========================================

    // Pass socket to logger if supported (we will add this to logger.js)
    if (log.setSocket) {
      log.setSocket(io);
    }

    app.set('io', io);
    app.set('deviceService', deviceService);


    app.use(cors()); // Enable CORS for all routes
    app.use(express.json());

    // Explicit Health Check for UI Polling
    app.get('/', (req, res) => res.status(200).send('Backend Online'));

    // Config endpoint for UI
    app.get('/config', (req, res) => {
      res.json({
        success: true,
        config: {
          ip: DEVICE_CONFIG.ip,
          port: DEVICE_CONFIG.port,
          timeout: DEVICE_CONFIG.timeout,
          useMockDevice: DEVICE_CONFIG.useMockDevice
        }
      });
    });



    // Serve Offline Data Statically (Photos)
    // Resolving the path same as offlineStorage.js
    const appDataPath = process.env.APPDATA ||
      (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
    const storageDir = path.join(appDataPath, 'ZK-Attendance', 'offline-data');

    // Mount /static to the offline data directory
    // This allows access to photos via http://localhost:5001/static/photos/USER_ID.jpg
    app.use('/static', express.static(storageDir));

    app.use('/', apiRoutes);
    app.use('/users', userManagementRoutes);



    server = httpServer.listen(PORT, async () => {
      log('success', `🚀 Server started successfully on port ${PORT}`);

      // Pre-warm user cache for fast lookups
      try {
        await prewarmCache();
      } catch (cacheErr) {
        log('warning', `Cache prewarming failed: ${cacheErr.message}`);
      }

      // Start sync service for offline mode
      try {
        syncService.startSync(io);
      } catch (syncErr) {
        log('warning', `Sync service failed to start: ${syncErr.message}`);
      }

      // Auto-discover device if enabled
      handleAutoDiscovery();



      resolve();
    });
  });
}

async function handleAutoDiscovery() {
  let deviceIP = null;
  let shouldConnect = true;

  if (DEVICE_CONFIG.useMockDevice) {
    deviceIP = "mock-device";
    shouldConnect = true;
  } else if (!DEVICE_CONFIG.useMockDevice && DEVICE_CONFIG.autoDiscoverDevice) {
    log('info', '🔍 Auto-discovery enabled. Scanning network for fingerprint device...');

    // Note: We can uses socket to emit scan-started if needed, but the UI might not be connected yet.
    // In sidecar mode, the UI connects after server starts.

    const maxRetries = DEVICE_CONFIG.autoDiscoveryRetries || 5;
    const retryDelay = DEVICE_CONFIG.autoDiscoveryRetryDelay || 3000;
    let discoveredIP = null;

    const overallStartTime = Date.now();
    const MINIMUM_SCAN_TIME = 5000; // Reduced for sidecar startup speed

    // Try to discover device with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      if (attempt > 1) {
        log('info', `🔄 Retry attempt ${attempt}/${maxRetries} - Scanning again in ${retryDelay / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }

      log('info', `🔍 Scanning network (attempt ${attempt}/${maxRetries})...`);

      try {
        const scanPromise = findFirstDevice(attempt === 1);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Scan timeout')), 40000)
        );
        discoveredIP = await Promise.race([scanPromise, timeoutPromise]);

        if (discoveredIP) {
          deviceIP = discoveredIP;
          log('success', `✅ Device discovered at ${deviceIP} on attempt ${attempt}/${maxRetries}`);
          DEVICE_CONFIG.ip = deviceIP;
          break;
        } else {
          if (attempt < maxRetries) log('warning', `⚠️ No device found on attempt ${attempt}/${maxRetries}`);
        }
      } catch (attemptError) {
        if (attempt < maxRetries) log('warning', `⚠️ Scan error on attempt ${attempt}/${maxRetries}: ${attemptError.message}`);
      }
    }

    if (!discoveredIP) {
      log('error', `❌ No device found after ${maxRetries} attempts!`);
      shouldConnect = false;
      // We don't have mainWindow to send specific error events to, but logs will show up via socket once connected
    }

  } else if (!DEVICE_CONFIG.useMockDevice) {
    deviceIP = DEVICE_CONFIG.ip;
    log('info', `Using configured static IP: ${deviceIP}`);
  }

  if (shouldConnect && deviceIP) {
    const connectionMessage = DEVICE_CONFIG.useMockDevice
      ? 'Initiating connection to MOCK device...'
      : `Initiating connection to eSSL K30 Pro device at ${deviceIP}...`;
    log('info', connectionMessage);

    try {
      const connected = await deviceService.connectToDevice(io);
      if (connected) {
        log('success', '✅ Successfully connected to device!');
        if (!DEVICE_CONFIG.useMockDevice) {
          log('info', '🎯 Initializing auto-enrollment from Firebase...');
          initializeMemberEnrollmentListener(deviceService);
        }

        if (DEVICE_CONFIG.useMockDevice) {
          deviceService.startPolling(io);
        } else {
          setTimeout(() => {
            log('info', 'Starting backup polling mechanism...');
            deviceService.startPolling(io);
          }, 10000);
        }
      } else {
        log('error', `❌ Failed to connect to device at ${deviceIP}`);
      }
    } catch (connectionError) {
      log('error', `❌ Connection error: ${connectionError.message}`);
    }
  }

  // ALWAYS start the watchdog.
  // If connected, it monitors. If not connected (failed above), it retries forever.
  if (!DEVICE_CONFIG.useMockDevice) {
    log('info', '🛡️ Initializing connection watchdog...');
    deviceService.startConnectionWatchdog(io);
  }
}

// Handle graceful shutdown
function stopServer() {
  return new Promise((resolve) => {
    syncService.stopSync();
    if (deviceService) {
      deviceService.stopPolling();
      if (deviceService.stopConnectionWatchdog) {
        deviceService.stopConnectionWatchdog();
      }
      deviceService.disconnectFromDevice().then(() => {
        if (server) {
          server.close(() => {
            log('info', 'Server stopped');
            resolve();
          });
        } else {
          resolve();
        }
      });
    } else {
      resolve();
    }
  });
}

process.on('SIGINT', async () => {
  await stopServer();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await stopServer();
  process.exit(0);
});

// Start the server
startServer().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
