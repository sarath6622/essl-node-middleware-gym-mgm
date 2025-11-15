// Electron Main Process
const { app, BrowserWindow, ipcMain, Menu, Tray } = require('electron');
const path = require('path');
const http = require('http');
const express = require('express');
const log = require('../utils/logger');
const { findFirstDevice } = require('../utils/networkScanner');
const initializeSocket = require('../services/socketService');
const apiRoutes = require('../routes/api');
const userManagementRoutes = require('../routes/userManagement');
const { initializeMemberEnrollmentListener } = require('../services/memberEnrollmentService');
const { prewarmCache } = require('../services/userService');
const DEVICE_CONFIG = require('../config/deviceConfig');

// Log app environment for debugging
console.log('=== App Environment ===');
console.log('Is Packaged:', app.isPackaged);
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('App Path:', app.getAppPath());
console.log('======================');

// Suppress console logs in production (disabled for debugging packaged builds)
// if (!app.isPackaged && process.env.NODE_ENV !== 'development') {
//   console.log = () => {};
//   console.info = () => {};
//   console.debug = () => {};
// }

let mainWindow = null;
let tray = null;
let server = null;
let io = null;
let deviceService = null;

const PORT = process.env.PORT || 5001;

// Express server setup
const expressApp = express();
const httpServer = http.createServer(expressApp);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png'),
    show: false,
    backgroundColor: '#1e1e2e'
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Handle window close
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open DevTools only in development
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }
  
  // Set electron window for logger
  log.setElectronWindow(mainWindow);
}

function createTray() {
  // You can replace this with a custom icon
  tray = new Tray(path.join(__dirname, 'icon.png'));
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show App', 
      click: () => {
        mainWindow.show();
      }
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('ZK Attendance Monitor');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow.show();
  });
}

async function startServer() {
  return new Promise((resolve) => {
    // Initialize device service
    deviceService = DEVICE_CONFIG.useMockDevice
      ? require('../services/mockDeviceService')
      : require('../services/deviceService');

    // Initialize Socket.IO
    io = initializeSocket(httpServer);

    expressApp.set('io', io);
    expressApp.set('deviceService', deviceService);

    expressApp.use(express.json());
    expressApp.use('/', apiRoutes);
    expressApp.use('/users', userManagementRoutes);

    server = httpServer.listen(PORT, async () => {
      log('success', `🚀 Server started successfully on port ${PORT}`);

      // Pre-warm user cache for fast lookups
      try {
        await prewarmCache();
      } catch (cacheErr) {
        log('warning', `Cache prewarming failed: ${cacheErr.message}`);
        // Continue anyway - cache will populate on first use
      }

      // Send status to renderer
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('server-started', { port: PORT });
      }

      // Auto-discover device if enabled
      let deviceIP = null;
      let shouldConnect = true;

      if (!DEVICE_CONFIG.useMockDevice && DEVICE_CONFIG.autoDiscoverDevice) {
        log('info', '');
        log('info', '🔍 Auto-discovery enabled. Scanning network for fingerprint device...');
        log('info', 'Note: Configured static IP will be ignored during auto-discovery');

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('scan-started');
        }

        try {
          log('info', `⏳ Scanning network... This typically takes 10-20 seconds`);
          log('info', `💡 Tip: Set autoDiscoverDevice: false in config to skip this and use static IP`);

          // Track start time for minimum delay
          const scanStartTime = Date.now();
          const MINIMUM_SCAN_TIME = 15000; // Minimum 15 seconds before showing error

          // Add timeout to prevent hanging - 40 seconds should be enough for most networks
          const scanPromise = findFirstDevice(true);
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Network scan timeout - no device found within 40 seconds')), 40000)
          );

          const discoveredIP = await Promise.race([scanPromise, timeoutPromise]);

          if (discoveredIP) {
            deviceIP = discoveredIP;
            log('success', `✅ Device discovered at ${deviceIP}`);
            DEVICE_CONFIG.ip = deviceIP;

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('device-discovered', { ip: deviceIP });
            }
          } else {
            // Ensure we've scanned for at least the minimum time
            const scanDuration = Date.now() - scanStartTime;
            if (scanDuration < MINIMUM_SCAN_TIME) {
              const remainingTime = MINIMUM_SCAN_TIME - scanDuration;
              log('info', `⏳ Completing thorough scan... ${Math.ceil(remainingTime / 1000)}s remaining`);
              await new Promise(resolve => setTimeout(resolve, remainingTime));
            }

            log('error', '❌ No device found during network scan!');
            log('error', '');
            log('error', 'Troubleshooting steps:');
            log('error', '  1. Ensure device is powered on');
            log('error', '  2. Check device is on the same network (WiFi/LAN)');
            log('error', '  3. Verify firewall is not blocking port 4370');
            log('error', '  4. Disable AP/Client isolation on your router');
            log('error', '  5. Set autoDiscoverDevice: false in config and use static IP');
            log('error', '');
            shouldConnect = false;

            // Only show modal after minimum scan time has elapsed
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('device-not-found', {
                suggestions: [
                  'Ensure the device is powered on',
                  'Check device is on the same WiFi/network',
                  'Disable AP isolation on your router',
                  'Try manual scan from the UI',
                  'Click "Reconnect" to scan again after device is online'
                ]
              });
            }
          }
        } catch (scanError) {
          // Track elapsed time
          const scanStartTime = Date.now();
          const scanDuration = Date.now() - scanStartTime;
          const MINIMUM_SCAN_TIME = 15000;

          // Ensure minimum time before showing error
          if (scanDuration < MINIMUM_SCAN_TIME) {
            const remainingTime = MINIMUM_SCAN_TIME - scanDuration;
            await new Promise(resolve => setTimeout(resolve, remainingTime));
          }

          log('error', `❌ Network scan failed: ${scanError.message}`);
          log('error', '');
          log('error', 'You can either:');
          log('error', '  • Click "Scan Network" in the UI to try again');
          log('error', '  • Set autoDiscoverDevice: false in config/deviceConfig.js');
          log('error', '  • Configure a static IP in config/deviceConfig.js');
          log('error', '');
          shouldConnect = false;
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('scan-failed', { error: scanError.message });
          }
        }
        log('info', '');
      } else if (!DEVICE_CONFIG.useMockDevice) {
        // Auto-discovery is disabled, use static IP from config
        deviceIP = DEVICE_CONFIG.ip;
        log('info', `Using configured static IP: ${deviceIP}`);
      }

      if (shouldConnect && deviceIP) {
        const connectionMessage = DEVICE_CONFIG.useMockDevice
          ? 'Initiating connection to MOCK device...'
          : `Initiating connection to eSSL K30 Pro device at ${deviceIP}...`;
        log('info', connectionMessage);

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('connecting', { ip: deviceIP, isMock: DEVICE_CONFIG.useMockDevice });
        }

        // Track connection start time
        const connectionStartTime = Date.now();
        const MINIMUM_CONNECTION_TIME = 10000; // Minimum 10 seconds before showing error

        try {
          log('info', '🔄 Attempting connection with retry logic...');
          const connected = await deviceService.connectToDevice(io);

          if (connected) {
            log('success', '✅ Successfully connected to device!');
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('device-connected', { ip: deviceIP });
            }

            // Initialize Firebase listener
            if (!DEVICE_CONFIG.useMockDevice) {
              log('info', '');
              log('info', '🎯 Initializing auto-enrollment from Firebase Realtime Database...');
              initializeMemberEnrollmentListener(deviceService);
            }

            if (DEVICE_CONFIG.useMockDevice) {
              log('info', '');
              log('info', '🔥 Mock device is active.');
              deviceService.startPolling(io);
            } else {
              setTimeout(() => {
                log('info', 'Starting backup polling mechanism...');
                deviceService.startPolling(io);
              }, 10000);
            }
          } else {
            // Ensure minimum time has elapsed before showing error
            const connectionDuration = Date.now() - connectionStartTime;
            if (connectionDuration < MINIMUM_CONNECTION_TIME) {
              const remainingTime = MINIMUM_CONNECTION_TIME - connectionDuration;
              log('info', `⏳ Verifying connection attempts... ${Math.ceil(remainingTime / 1000)}s`);
              await new Promise(resolve => setTimeout(resolve, remainingTime));
            }

            log('error', `❌ Failed to connect to device at ${deviceIP}`);
            log('error', 'Please check:');
            log('error', '  • Device IP is correct');
            log('error', '  • Device is powered on and accessible');
            log('error', '  • No other application is using the device');

            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('connection-failed', {
                ip: deviceIP,
                suggestions: [
                  `Verify device is accessible at ${deviceIP}`,
                  'Ensure no other app is connected to the device',
                  'Try power cycling the device',
                  'Check network connectivity',
                  'Click "Reconnect" to try again'
                ]
              });
            }
          }
        } catch (connectionError) {
          // Ensure minimum time has elapsed before showing error
          const connectionDuration = Date.now() - connectionStartTime;
          if (connectionDuration < MINIMUM_CONNECTION_TIME) {
            const remainingTime = MINIMUM_CONNECTION_TIME - connectionDuration;
            log('info', `⏳ Completing connection checks... ${Math.ceil(remainingTime / 1000)}s`);
            await new Promise(resolve => setTimeout(resolve, remainingTime));
          }

          log('error', `❌ Connection error: ${connectionError.message}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('connection-failed', {
              ip: deviceIP,
              error: connectionError.message,
              suggestions: [
                'Check device power and network',
                'Verify device is not being used by another application',
                'Try reconnecting'
              ]
            });
          }
        }
      }

      resolve();
    });

    // Handle real-time attendance events
    io.on('connection', (socket) => {
      log('info', 'UI connected via Socket.IO');
    });
  });
}

function stopServer() {
  return new Promise((resolve) => {
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

// IPC Handlers
ipcMain.handle('get-config', () => {
  // Always return the current runtime IP, not the static config
  return {
    useMockDevice: DEVICE_CONFIG.useMockDevice,
    autoDiscoverDevice: DEVICE_CONFIG.autoDiscoverDevice,
    ip: DEVICE_CONFIG.ip, // This will be the discovered IP if auto-discovery ran
    port: DEVICE_CONFIG.port,
    timezone: DEVICE_CONFIG.timezone
  };
});

ipcMain.handle('scan-network', async () => {
  const { scanForDevices } = require('../utils/networkScanner');
  try {
    const devices = await scanForDevices(false);
    
    // Include currently connected device IP
    const connectedIP = (deviceService && deviceService.isConnected && deviceService.isConnected()) 
      ? DEVICE_CONFIG.ip 
      : null;
    
    return { 
      success: true, 
      devices,
      connectedIP 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-status', () => {
  if (!deviceService) {
    return { connected: false, error: 'Service not initialized' };
  }
  return {
    connected: deviceService.isConnected(),
    deviceIp: DEVICE_CONFIG.useMockDevice ? 'mock-device' : DEVICE_CONFIG.ip,
    devicePort: DEVICE_CONFIG.useMockDevice ? null : DEVICE_CONFIG.port,
    isMock: DEVICE_CONFIG.useMockDevice,
    serverPort: PORT
  };
});

ipcMain.handle('reconnect', async () => {
  if (!deviceService || !io) {
    return { success: false, error: 'Service not initialized' };
  }
  
  // If auto-discovery is enabled, scan for device first
  if (!DEVICE_CONFIG.useMockDevice && DEVICE_CONFIG.autoDiscoverDevice) {
    log('info', '🔍 Running auto-discovery before reconnection...');
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan-started');
    }
    
    try {
      const discoveredIP = await findFirstDevice(true);
      
      if (discoveredIP) {
        DEVICE_CONFIG.ip = discoveredIP;
        log('success', `✅ Device discovered at ${discoveredIP}`);
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('device-discovered', { ip: discoveredIP });
        }
      } else {
        log('warning', '⚠️ Auto-discovery found no device, using configured IP');
        
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('device-not-found', {
            suggestions: [
              'Device may not be on the network',
              'Trying to connect with configured IP as fallback'
            ]
          });
        }
      }
    } catch (scanError) {
      log('warning', `Scan failed during reconnect: ${scanError.message}`);
      log('warning', 'Proceeding with configured IP...');
    }
  }
  
  // Attempt connection with discovered or configured IP
  const success = await deviceService.connectToDevice(io);
  return { success };
});

ipcMain.handle('connect-to-ip', async (event, ip) => {
  if (!deviceService || !io) {
    return { success: false, error: 'Service not initialized' };
  }
  
  log('info', `User manually selected device at ${ip}`);
  
  // Update the config with the selected IP
  DEVICE_CONFIG.ip = ip;
  
  // Send connecting status
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connecting', { ip: ip, isMock: false });
  }
  
  try {
    // Disconnect from any existing connection first
    if (deviceService.isConnected && deviceService.isConnected()) {
      log('info', 'Disconnecting from current device...');
      await deviceService.disconnectFromDevice();
    }
    
    // Attempt connection
    const connected = await deviceService.connectToDevice(io);
    
    if (connected) {
      log('success', `✅ Successfully connected to device at ${ip}`);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('device-connected', { ip: ip });
      }
      
      // Initialize Firebase listener if not mock device
      if (!DEVICE_CONFIG.useMockDevice) {
        log('info', '🎯 Initializing auto-enrollment from Firebase...');
        initializeMemberEnrollmentListener(deviceService);
      }
      
      // Start polling
      setTimeout(() => {
        log('info', 'Starting backup polling mechanism...');
        deviceService.startPolling(io);
      }, 10000);
      
      return { success: true };
    } else {
      log('error', `❌ Failed to connect to device at ${ip}`);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('connection-failed', {
          ip: ip,
          suggestions: [
            `Verify device is accessible at ${ip}`,
            'Ensure no other app is connected to the device',
            'Try power cycling the device'
          ]
        });
      }
      
      return { success: false, error: 'Connection failed' };
    }
  } catch (error) {
    log('error', `Connection error: ${error.message}`);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('connection-failed', {
        ip: ip,
        error: error.message
      });
    }
    
    return { success: false, error: error.message };
  }
});

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  
  // Wait for window to be ready before starting server
  mainWindow.webContents.on('did-finish-load', async () => {
    // Small delay to ensure renderer is fully initialized
    setTimeout(async () => {
      await startServer();
    }, 500);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Quit app when all windows are closed on all platforms
  app.quit();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  await stopServer();
});

process.on('SIGINT', async () => {
  await stopServer();
  app.quit();
});

process.on('SIGTERM', async () => {
  await stopServer();
  app.quit();
});
