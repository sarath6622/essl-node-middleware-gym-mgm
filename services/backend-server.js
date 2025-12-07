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

// Environment Setup
const PORT = process.env.PORT || 5001;

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
}

// Handle graceful shutdown
function stopServer() {
    return new Promise((resolve) => {
      syncService.stopSync();
      if (deviceService) {
        deviceService.stopPolling();
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
