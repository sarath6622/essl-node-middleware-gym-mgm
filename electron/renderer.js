// Renderer Process JavaScript
// UI logic and event handling

// NOTE: Sentry for browser needs to be loaded via CDN or bundler, not require()
// For now, frontend error tracking is disabled. Backend still tracks errors.
// To enable: Add Sentry CDN script to index.html and use window.Sentry

let totalEvents = 0;
let todayEvents = 0;
let socket = null;

// Duplicate detection - tracks recent events to prevent duplicate processing
const recentEvents = new Map(); // Key: userId-timestamp, Value: timestamp when added
const DUPLICATE_WINDOW = 5000; // 5 seconds window to detect duplicates

// System status tracking
let systemStatus = {
  server: false,
  database: false,
  device: false,
  socket: false
};

// DOM Elements
const connectionStatus = document.getElementById('connectionStatus');
const deviceIP = document.getElementById('deviceIP');
const totalEventsEl = document.getElementById('totalEvents');
const todayEventsEl = document.getElementById('todayEvents');
const eventsContainer = document.getElementById('eventsContainer');
const logsContainer = document.getElementById('logsContainer');
const footerStatus = document.getElementById('footerStatus');
const reconnectBtn = document.getElementById('reconnectBtn');
const clearBtn = document.getElementById('clearBtn');
const devicesModal = document.getElementById('devicesModal');
const modalClose = document.getElementById('modalClose');
const modalBody = document.getElementById('modalBody');

// Status checklist elements
const checkServer = document.getElementById('checkServer');
const checkDatabase = document.getElementById('checkDatabase');
const checkDevice = document.getElementById('checkDevice');
const checkSocket = document.getElementById('checkSocket');
const readyStatus = document.getElementById('readyStatus');

// Offline/Sync status elements
const offlineSyncStatus = document.getElementById('offlineSyncStatus');
const syncDetails = document.getElementById('syncDetails');
const forceSyncBtn = document.getElementById('forceSyncBtn');
const refreshCacheBtn = document.getElementById('refreshCacheBtn');

// Initialize
async function init() {
  console.log('[DEBUG] init() started');
  try {
    updateStatus('Initializing...', 'disconnected');

    // Check if electronAPI is available
    console.log('[DEBUG] Checking window.electronAPI...');
    if (!window.electronAPI) {
      console.error('[DEBUG] electronAPI NOT available!');
      footerStatus.textContent = 'Error: electronAPI not available';
      return;
    }
    console.log('[DEBUG] electronAPI is available');

    // Load speech synthesis voices (needed for text-to-speech)
    if ('speechSynthesis' in window) {
      // Load voices - they may not be immediately available
      window.speechSynthesis.getVoices();
      // Also listen for voices changed event
      window.speechSynthesis.addEventListener('voiceschanged', () => {
        console.log('Speech synthesis voices loaded:', window.speechSynthesis.getVoices().length);
      });
    }

    // Load configuration with retry
    let config = null;
    let retryCount = 0;
    const MAX_RETRIES = 30;

    const loadingOverlay = document.getElementById('loadingOverlay');

    // Wait for Backend Server to be ready (HTTP check)
    // Wait for Backend Server to be ready (HTTP check)
    // Non-blocking approach: Try for 5 seconds, then proceed to allow UI to load
    let backendReady = false;
    let retries = 0;
    const MAX_WAIT_RETRIES = 5; // Wait max 5 seconds before showing UI

    while (!backendReady && retries < MAX_WAIT_RETRIES) {
      try {
        const response = await fetch('http://localhost:5001/');
        if (response.ok || response.status === 404) {
          backendReady = true;
          updateStatus('Backend connected', 'connected');
        }
      } catch (e) {
        retries++;
        console.log(`Waiting for backend server... (${retries}/${MAX_WAIT_RETRIES})`);
        updateStatus(`Starting backend service... (${retries})`, 'scanning');
        if (loadingOverlay) loadingOverlay.querySelector('div').textContent = `Starting Backend Service... (${retries})`;
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Even if not ready, we proceed so the user can see the logs interface
    // Socket.io will handle the actual reconnection logic
    if (!backendReady) {
      console.warn('Backend not yet ready, proceeding to load UI to show logs...');
      updateStatus('Backend starting...', 'offline');
    }

    // Now get config via IPC (non-blocking - try 3 times then proceed)
    const CONFIG_RETRIES = 3;
    while (!config && retryCount < CONFIG_RETRIES) {
      try {
        config = await window.electronAPI.getConfig();
      } catch (e) {
        retryCount++;
        console.warn(`Config fetch failed (${retryCount}/${CONFIG_RETRIES}):`, e.message);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    // Hide overlay regardless of config success - UI should always load
    if (loadingOverlay) loadingOverlay.style.display = 'none';

    // If no config, use defaults and proceed anyway
    if (!config) {
      console.warn('Could not fetch config, using defaults. Socket.IO will handle connection.');
      config = { ip: 'auto', port: 4370 }; // Default values
    }

    displayConfig(config);
    console.log('[DEBUG] Config displayed, setting up Socket.IO...');

    // Setup Socket.IO connection
    setupSocketIO();
    console.log('[DEBUG] Socket.IO setup complete');

    // Setup event listeners
    setupEventListeners();
    console.log('[DEBUG] Event listeners setup complete');

    // Setup IPC listeners
    setupIPCListeners();

    // Setup sync status monitoring
    setupSyncMonitoring();
    console.log('[DEBUG] All setup complete');
  } catch (error) {
    footerStatus.textContent = 'Error: ' + error.message;
  }
}

// Display Configuration
function displayConfig(config) {
  // Configuration is now minimal - deviceIP is updated elsewhere
}

// Setup Socket.IO for real-time events
function setupSocketIO() {
  try {
    // Socket.IO client is bundled locally, should always be available
    if (typeof io === 'undefined') {
      console.error('Socket.IO client library not loaded!');
      footerStatus.textContent = 'Socket.IO library missing';
      return;
    }

    console.log('Connecting to Socket.IO server at http://localhost:5001');
    socket = io('http://localhost:5001');

    socket.on('connect', () => {
      console.log('✅ Socket.IO connected to server');
      footerStatus.textContent = 'Socket.IO connected - waiting for device connection';
      updateSystemStatus('socket', true);
      updateSystemStatus('server', true); // Connection implies server is up
    });

    socket.on('system_status', (status) => {
      console.log('Using initial system status:', status);
      if (status.server) updateSystemStatus('server', true);
      if (status.database) updateSystemStatus('database', true);
      if (status.device) updateSystemStatus('device', true);
      if (status.socket) updateSystemStatus('socket', true);
    });

    socket.on('connect_error', (error) => {
      console.error('❌ Socket.IO connection error:', error);
      footerStatus.textContent = 'Socket connection error';
      updateSystemStatus('socket', false);
      updateSystemStatus('server', false);
    });

    socket.on('disconnect', () => {
      console.log('⚠️ Socket.IO disconnected');
      footerStatus.textContent = 'Socket disconnected';
      updateStatus('Disconnected', 'disconnected');
      updateSystemStatus('socket', false);
      updateSystemStatus('server', false);
    });

    socket.on('attendance_event', (data) => {
      console.log('📥 Received attendance_event from server:', data);
      addAttendanceEvent(data);
    });

    socket.on('fingerprint_failed', (data) => {
      console.log('❌ Fingerprint not recognized');
      playErrorBeep();
      setTimeout(() => {
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance('Fingerprint not recognized. Please try again.');
          utterance.rate = 0.95;
          utterance.pitch = 1.1;
          utterance.volume = 1.0;

          // Use the same natural female voice selection
          const voices = window.speechSynthesis.getVoices();
          const preferredVoice =
            voices.find(v => v.lang.startsWith('en') && (v.name.includes('Zira') || v.name.includes('Aria'))) ||
            voices.find(v => v.lang.startsWith('en') && v.name.includes('Google') && v.name.includes('US')) ||
            voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) ||
            voices.find(v => v.lang.startsWith('en') && !v.name.toLowerCase().includes('male')) ||
            voices.find(v => v.lang.startsWith('en'));

          if (preferredVoice) {
            utterance.voice = preferredVoice;
          }

          window.speechSynthesis.speak(utterance);
        }
      }, 200);
      footerStatus.textContent = 'Fingerprint not recognized';
    });

    // Listen for any event to debug
    socket.onAny((eventName, ...args) => {
      console.log(`📡 Socket.IO event received: ${eventName}`, args);
    });

    socket.on('device_status', (data) => {
      if (data.connected) {
        updateStatus('Connected', 'connected');
        footerStatus.textContent = `Device connected at ${data.deviceIp}`;
        updateSystemStatus('device', true);
        deviceIP.textContent = data.deviceIp;
      } else {
        updateStatus('Disconnected', 'disconnected');
        updateSystemStatus('device', 'error');
      }
    });

    // Sync-related events
    socket.on('connection_status', (data) => {
      console.log('Connection status changed:', data.online ? 'Online' : 'Offline');
      updateSyncStatus();
    });

    socket.on('attendance_saved_offline', (data) => {
      console.log('📦 Attendance saved offline:', data);
      updateSyncStatus();
    });

    socket.on('sync_progress', (data) => {
      console.log('🔄 Sync progress:', data);
      const syncText = offlineSyncStatus.querySelector('.sync-text');
      if (syncText) {
        syncText.textContent = `Syncing... ${data.progress}%`;
      }
    });

    socket.on('sync_complete', (data) => {
      console.log('✅ Sync complete:', data);
      updateSyncStatus();
    });

    socket.on('sync_error', (data) => {
      console.error('❌ Sync error:', data);
      updateSyncStatus();
    });

    // Cache refresh event
    socket.on('cache_refreshed', (data) => {
      console.log('✅ Cache refreshed:', data);
      footerStatus.textContent = `User cache refreshed - ${data.usersLoaded} users loaded in ${data.duration}ms`;

      // Show success notification
      showCacheRefreshNotification(data);
    });

    // Receive logs via socket (Sidecar mode)
    socket.on('log-message', (logData) => {
      addLogMessage(logData);
    });

  } catch (error) {
    footerStatus.textContent = 'Socket.IO setup failed: ' + error.message;
  }
}

// Setup Event Listeners
function setupEventListeners() {
  reconnectBtn.addEventListener('click', handleReconnect);
  clearBtn.addEventListener('click', handleClear);
  refreshCacheBtn.addEventListener('click', handleRefreshCache);
  modalClose.addEventListener('click', () => {
    devicesModal.classList.remove('active');
  });

  // Close modal on background click
  devicesModal.addEventListener('click', (e) => {
    if (e.target === devicesModal) {
      devicesModal.classList.remove('active');
    }
  });
}

// IPC Event Listeners
function setupIPCListeners() {
  // Listen to IPC events from main process
  window.electronAPI.onServerStarted((data) => {
    footerStatus.textContent = `Server running on port ${data.port}`;
    updateSystemStatus('server', true);
    updateSystemStatus('database', true); // Firebase initializes with server
  });

  window.electronAPI.onScanStarted(() => {
    updateStatus('Scanning network...', 'scanning');
    footerStatus.textContent = 'Scanning for devices...';
    updateSystemStatus('device', 'Scanning...');
  });

  window.electronAPI.onDeviceDiscovered((data) => {
    deviceIP.textContent = data.ip;
    footerStatus.textContent = `Device discovered at ${data.ip}`;
    updateSystemStatus('device', 'Connecting...');
  });

  window.electronAPI.onDeviceNotFound((data) => {
    updateStatus('No device found', 'disconnected');
    deviceIP.textContent = '-';
    footerStatus.textContent = 'No device found on network';
    updateSystemStatus('device', 'error');

    // Show suggestions
    if (data && data.suggestions) {
      showErrorModal('Device Not Found', 'No fingerprint device was found on your network.', data.suggestions);
    }
  });

  window.electronAPI.onScanFailed((data) => {
    updateStatus('Scan failed', 'disconnected');
    deviceStatus.textContent = 'Scan Error';
    footerStatus.textContent = `Scan failed: ${data.error || 'Unknown error'}`;
    updateSystemStatus('device', 'error');

    showErrorModal('Network Scan Failed', data.error || 'An error occurred during network scanning.', [
      'Check your network connection',
      'Try manual scan from the UI',
      'Restart the application'
    ]);
  });

  window.electronAPI.onConnecting((data) => {
    updateStatus('Connecting...', 'scanning');
    deviceIP.textContent = data.ip;
    deviceMode.textContent = data.isMock ? 'Mock' : 'Real Device';
    footerStatus.textContent = `Connecting to ${data.ip}...`;
    updateSystemStatus('device', 'Connecting...');
  });

  window.electronAPI.onDeviceConnected((data) => {
    updateStatus('Connected', 'connected');
    deviceIP.textContent = data.ip;
    footerStatus.textContent = `Connected to device at ${data.ip}`;
    updateSystemStatus('device', true);
  });

  window.electronAPI.onConnectionFailed((data) => {
    updateStatus('Connection failed', 'disconnected');
    deviceIP.textContent = data.ip || '-';
    footerStatus.textContent = `Failed to connect to ${data.ip || 'device'}`;
    updateSystemStatus('device', 'error');

    // Show suggestions
    if (data && data.suggestions) {
      const errorMsg = data.error
        ? `Connection error: ${data.error}`
        : `Could not connect to device at ${data.ip}`;
      showErrorModal('Connection Failed', errorMsg, data.suggestions);
    }
  });

  // Listen for log messages
  window.electronAPI.onLogMessage((logData) => {
    addLogMessage(logData);
  });
}

// Update Status Indicator
function updateStatus(text, status) {
  connectionStatus.querySelector('.status-text').textContent = text;
  connectionStatus.className = 'status-indicator ' + status;
}

// Show Error Modal with Suggestions
function showErrorModal(title, message, suggestions = []) {
  const suggestionsHTML = suggestions.map(s => `<li>${s}</li>`).join('');

  modalBody.innerHTML = `
    <div class="error-modal-content">
      <div class="error-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10" stroke="#ef4444"/>
          <line x1="12" y1="8" x2="12" y2="12" stroke="#ef4444"/>
          <line x1="12" y1="16" x2="12.01" y2="16" stroke="#ef4444"/>
        </svg>
      </div>
      <p class="error-message">${message}</p>
      ${suggestions.length > 0 ? `
        <div class="suggestions-box">
          <h4>💡 Suggestions:</h4>
          <ul>${suggestionsHTML}</ul>
        </div>
      ` : ''}
      <div class="error-actions">
        <button class="btn btn-primary" onclick="document.getElementById('devicesModal').classList.remove('active')">
          OK
        </button>
        <button class="btn btn-secondary" id="retryBtn">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
          </svg>
          Retry Connection
        </button>
      </div>
    </div>
  `;

  // Update modal title
  const modalHeader = document.querySelector('.modal-header h2');
  if (modalHeader) {
    modalHeader.textContent = title;
  }

  // Show modal
  devicesModal.classList.add('active');

  // Attach retry handler
  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleReconnect);
  }
}

// Add Log Message
function addLogMessage(logData) {
  const logEl = document.createElement('div');
  logEl.className = `log-item log-${logData.level}`;

  logEl.innerHTML = `
    <span class="log-prefix">${logData.prefix}</span>
    <span class="log-text">${logData.message}</span>
  `;

  // Add to logs container
  logsContainer.appendChild(logEl);

  // Keep only last 50 log entries
  const logs = logsContainer.querySelectorAll('.log-item');
  if (logs.length > 50) {
    logs[0].remove();
  }

  // Auto-scroll to bottom
  logsContainer.scrollTop = logsContainer.scrollHeight;
}


// Display Discovered Devices
function displayDevices(devices, connectedIP = null) {
  const deviceList = devices.map((device, index) => {
    const isConnected = connectedIP && device.ip === connectedIP;

    return `
    <div class="device-item ${isConnected ? 'device-item-connected' : ''}">
      <div class="device-item-info">
        <div class="device-item-name">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
            <line x1="6" y1="6" x2="6.01" y2="6"/>
            <line x1="6" y1="18" x2="6.01" y2="18"/>
          </svg>
          ${device.name || `Device ${device.ip.split('.').pop()}`}
          ${isConnected ? '<span class="badge badge-success device-connected-badge">Connected</span>' : ''}
        </div>
        <div class="device-item-details">
          <span class="device-detail-item">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            ${device.ip}:${device.port}
          </span>
          ${device.model && device.model !== 'Unknown' ? `
            <span class="device-detail-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
                <rect x="9" y="9" width="6" height="6"/>
              </svg>
              ${device.model}
            </span>
          ` : ''}
          ${device.serialNumber && device.serialNumber !== 'Unknown' ? `
            <span class="device-detail-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              SN: ${device.serialNumber}
            </span>
          ` : ''}
        </div>
      </div>
      ${isConnected ? `
        <span class="badge badge-success">Active</span>
      ` : `
        <button class="btn btn-primary btn-sm" onclick="connectToDevice('${device.ip}', ${index})">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
          Connect
        </button>
      `}
    </div>
  `;
  }).join('');

  modalBody.innerHTML = `
    <div class="device-list-header">
      <p>Found ${devices.length} device(s) on your network. ${connectedIP ? 'Currently connected device is highlighted.' : 'Click "Connect" to use a device.'}</p>
    </div>
    <div class="device-list">${deviceList}</div>
  `;
  devicesModal.classList.add('active');
}

// Connect to Specific Device
window.connectToDevice = async function (ip, index) {
  // Disable all connect buttons
  const buttons = document.querySelectorAll('.device-item .btn');
  buttons.forEach(btn => {
    btn.disabled = true;
  });

  // Update the clicked button to show loading
  const clickedBtn = buttons[index];
  if (clickedBtn) {
    clickedBtn.innerHTML = '<span class="spinner"></span> Connecting...';
  }

  // Close modal and update status
  setTimeout(() => {
    devicesModal.classList.remove('active');
  }, 300);

  updateStatus('Connecting...', 'scanning');
  footerStatus.textContent = `Connecting to ${ip}...`;

  try {
    const result = await window.electronAPI.connectToIP(ip);

    if (result.success) {
      updateStatus('Connected', 'connected');
      deviceStatus.textContent = 'Connected';
      deviceIP.textContent = ip;
      footerStatus.textContent = `Connected to device at ${ip}`;
    } else {
      updateStatus('Connection failed', 'disconnected');
      deviceStatus.textContent = 'Failed';
      footerStatus.textContent = `Failed to connect to ${ip}`;

      // Show error with retry option
      setTimeout(() => {
        showErrorModal('Connection Failed', result.error || `Could not connect to device at ${ip}`, [
          'Ensure device is powered on',
          'Check device is accessible',
          'Try connecting to a different device',
          'Run network scan again'
        ]);
      }, 500);
    }
  } catch (error) {
    updateStatus('Connection failed', 'disconnected');
    footerStatus.textContent = 'Connection error: ' + error.message;

    setTimeout(() => {
      showErrorModal('Connection Error', `An error occurred: ${error.message}`, [
        'Check network connection',
        'Try scanning again',
        'Restart the application'
      ]);
    }, 500);
  }
}

// Handle Reconnect
async function handleReconnect() {
  // Close error modal if open
  devicesModal.classList.remove('active');

  // Disable button
  reconnectBtn.disabled = true;

  reconnectBtn.innerHTML = '<span class="spinner"></span> Reconnecting...';
  updateStatus('Reconnecting...', 'scanning');
  footerStatus.textContent = 'Attempting to reconnect...';

  try {
    const result = await window.electronAPI.reconnect();

    if (result.success) {
      updateStatus('Connected', 'connected');
      deviceStatus.textContent = 'Connected';
      footerStatus.textContent = 'Reconnected successfully';
    } else {
      updateStatus('Connection failed', 'disconnected');
      deviceStatus.textContent = 'Failed';
      footerStatus.textContent = 'Reconnection failed - check device and try again';

      // Show error after a moment
      setTimeout(() => {
        showErrorModal('Reconnection Failed', 'Could not reconnect to the device.', [
          'Ensure device is powered on',
          'Check network connection',
          'Verify device IP is correct',
          'Try scanning for the device again'
        ]);
      }, 500);
    }
  } catch (error) {
    updateStatus('Connection failed', 'disconnected');
    footerStatus.textContent = 'Reconnection error: ' + error.message;

    setTimeout(() => {
      showErrorModal('Reconnection Error', `An error occurred: ${error.message}`, [
        'Check your network connection',
        'Restart the application',
        'Try scanning for the device'
      ]);
    }, 500);
  } finally {
    reconnectBtn.disabled = false;
    reconnectBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Reconnect
    `;
  }
}

// Handle Clear Events
function handleClear() {
  const emptyState = eventsContainer.querySelector('.empty-state');
  eventsContainer.innerHTML = '';
  if (emptyState) {
    eventsContainer.appendChild(emptyState);
  } else {
    eventsContainer.innerHTML = `
      <div class="empty-state">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <h3>Waiting for Events</h3>
        <p>Attendance events will appear here in real-time</p>
      </div>
    `;
  }
  totalEvents = 0;
  todayEvents = 0;
  updateStats();
  footerStatus.textContent = 'Events cleared';
}

// Handle Refresh User Cache
async function handleRefreshCache() {
  // Disable button
  refreshCacheBtn.disabled = true;
  refreshCacheBtn.innerHTML = '<span class="spinner"></span> Refreshing...';
  footerStatus.textContent = 'Refreshing user cache...';

  try {
    const response = await fetch('http://localhost:5001/users/refresh-cache', {
      method: 'POST'
    });

    const data = await response.json();

    if (data.success) {
      footerStatus.textContent = `Cache refreshed - ${data.stats.usersLoaded} users loaded in ${data.stats.duration}ms`;

      // Add success log
      addLogMessage({
        level: 'success',
        prefix: '✅',
        message: `User cache refreshed: ${data.stats.usersLoaded} users loaded`
      });
    } else {
      footerStatus.textContent = 'Failed to refresh cache: ' + (data.message || 'Unknown error');

      // Add error log
      addLogMessage({
        level: 'error',
        prefix: '❌',
        message: 'Failed to refresh user cache: ' + (data.message || 'Unknown error')
      });
    }
  } catch (error) {
    footerStatus.textContent = 'Cache refresh error: ' + error.message;

    // Add error log
    addLogMessage({
      level: 'error',
      prefix: '❌',
      message: 'Cache refresh error: ' + error.message
    });
  } finally {
    refreshCacheBtn.disabled = false;
    refreshCacheBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M17 1l4 4-4 4"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <path d="M7 23l-4-4 4-4"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      </svg>
      Refresh User Cache
    `;
  }
}

// Show cache refresh notification (called from socket event)
function showCacheRefreshNotification(data) {
  addLogMessage({
    level: 'success',
    prefix: '✅',
    message: `Cache auto-refreshed: ${data.usersLoaded} users loaded in ${data.duration}ms`
  });
}

// Text-to-Speech function to welcome user
function speakWelcome(userName, membershipStatus, membershipEndDate) {
  // Check if browser supports speech synthesis
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();

    console.log('Speaking welcome for:', { userName, membershipStatus, membershipEndDate });

    // Get time-based greeting
    const hour = new Date().getHours();
    let greeting;
    if (hour < 12) {
      greeting = 'Good morning.';
    } else if (hour < 17) {
      greeting = 'Good afternoon';
    } else {
      greeting = 'Good evening';
    }

    let message;
    let isExpired = false;
    let daysRemaining = null;
    let daysExpired = null;

    // Check membership expiration FIRST (regardless of status field)
    if (membershipEndDate) {
      const endDate = new Date(membershipEndDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day
      endDate.setHours(0, 0, 0, 0);

      daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

      if (daysRemaining < 0) {
        isExpired = true;
        daysExpired = Math.abs(daysRemaining);
      }
    }

    // Build message based on ACTUAL expiration status (not membershipStatus field)
    if (membershipStatus === 'unknown') {
      message = `Attention. Unknown user detected. ID ${userName.split('ID: ')[1] || 'not found'}`;
    } else if (isExpired) {
      // EXPIRED - membership end date is in the past
      if (daysExpired > 0) {
        if (daysExpired === 1) {
          message = `${greeting} ${userName}. Your membership has expired yesterday.`;
        } else {
          message = `${greeting} ${userName}. Your membership has expired ${daysExpired} days ago.`;
        }
      } else {
        message = `${greeting} ${userName}. Your membership has expired.`;
      }
    } else {
      // ACTIVE or NO END DATE - decide whether to include the brand welcome
      const aboutToExpire = daysRemaining !== null && daysRemaining <= 5 && daysRemaining >= 0;
      const hasPendingFees = typeof membershipStatus === 'string' && /pending|due|overdue|unpaid|fees/i.test(membershipStatus);

      // If user has no pending fees and membership is not about to expire, include brand welcome
      const includeBrandWelcome = !aboutToExpire && !hasPendingFees;

      if (includeBrandWelcome) {
        message = `${greeting} ${userName}, welcome to V3 Fitness.`;
      } else {
        // Still provide a polite greeting but avoid the brand welcome when membership is about to expire or has pending fees
        message = `${greeting} ${userName}.`;
      }

      // Add expiration warning if within 5 days (but do not append the brand welcome when about to expire)
      if (daysRemaining !== null) {
        if (daysRemaining === 0) {
          message += ` Your membership expires today.`;
        } else if (daysRemaining === 1) {
          message += ` Your membership expires tomorrow.`;
        } else if (daysRemaining > 0 && daysRemaining <= 5) {
          message += ` Your membership expires in ${daysRemaining} days.`;
        }
      }
    }

    console.log('Speech message:', message);

    // Function to speak with loaded voices
    const speakMessage = () => {
      const utterance = new SpeechSynthesisUtterance(message);

      // Get available voices
      const voices = window.speechSynthesis.getVoices();
      console.log('Available voices:', voices.length);

      // Log all available voices for debugging
      voices.forEach((v, i) => console.log(`Voice ${i}: ${v.name} (${v.lang})`));

      // Priority order for natural voices (Windows-optimized):
      // 1. Microsoft Neural/Online voices (Windows 10/11 - very natural)
      // 2. Microsoft Aria, Jenny, Zira (high quality Windows voices)
      // 3. Google voices (Chrome/Chromium)
      // 4. macOS premium voices (Samantha, Karen)
      // 5. Any English female voice
      // 6. Any English voice
      const preferredVoice =
        // Windows Neural voices (most natural on Windows 10/11)
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Online') && v.name.includes('Natural')) ||
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Jenny')) ||
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Aria')) ||
        // Standard Windows voices
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Zira')) ||
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Hazel')) ||
        // Google Chrome voices
        voices.find(v => v.lang.startsWith('en') && v.name.includes('Google') && v.name.includes('US')) ||
        // macOS premium voices
        voices.find(v => v.lang.startsWith('en') && (v.name.includes('Samantha') || v.name.includes('Karen'))) ||
        // Any female English voice
        voices.find(v => v.lang.startsWith('en') && v.name.toLowerCase().includes('female')) ||
        voices.find(v => v.lang.startsWith('en-US')) ||
        voices.find(v => v.lang.startsWith('en'));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
        console.log('Using voice:', preferredVoice.name);

        // Adjust speech parameters based on the selected voice for more natural sound
        if (preferredVoice.name.includes('Online') || preferredVoice.name.includes('Natural')) {
          // Neural voices - already natural, use closer to default settings
          utterance.rate = 1.0;
          utterance.pitch = 1.0;
        } else if (preferredVoice.name.includes('Zira') || preferredVoice.name.includes('Hazel')) {
          // Standard Windows voices - slow down and adjust pitch for warmer sound
          utterance.rate = 0.9;
          utterance.pitch = 1.05;
        } else if (preferredVoice.name.includes('Google')) {
          // Google voices - slightly slower
          utterance.rate = 0.95;
          utterance.pitch = 1.0;
        } else {
          // Default settings for other voices
          utterance.rate = 0.92;
          utterance.pitch = 1.0;
        }
      } else {
        console.log('Using default voice');
        utterance.rate = 0.9;
        utterance.pitch = 1.0;
      }

      utterance.volume = 1.0; // Full volume

      // Add event listeners for debugging
      utterance.onstart = () => console.log('Speech started');
      utterance.onend = () => console.log('Speech ended');
      utterance.onerror = (e) => console.error('Speech error:', e);

      window.speechSynthesis.speak(utterance);
    };

    // Ensure voices are loaded before speaking
    const voices = window.speechSynthesis.getVoices();
    if (voices.length > 0) {
      speakMessage();
    } else {
      // Wait for voices to load
      console.log('Waiting for voices to load...');
      window.speechSynthesis.addEventListener('voiceschanged', speakMessage, { once: true });
    }
  }
}

// Play success beep sound
function playSuccessBeep() {
  // Create audio context for beep sound
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  // Configure beep - pleasant double beep
  oscillator.frequency.value = 800; // Hz
  oscillator.type = 'sine';

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.1);

  // Second beep
  setTimeout(() => {
    const oscillator2 = audioContext.createOscillator();
    const gainNode2 = audioContext.createGain();

    oscillator2.connect(gainNode2);
    gainNode2.connect(audioContext.destination);

    oscillator2.frequency.value = 1000; // Slightly higher pitch
    oscillator2.type = 'sine';

    gainNode2.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);

    oscillator2.start(audioContext.currentTime);
    oscillator2.stop(audioContext.currentTime + 0.1);
  }, 100);
}

// Play error beep for unknown users
function playErrorBeep() {
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.frequency.value = 400; // Lower frequency for error
  oscillator.type = 'sawtooth';

  gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
  gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

  oscillator.start(audioContext.currentTime);
  oscillator.stop(audioContext.currentTime + 0.3);
}

// Add Attendance Event to UI
function addAttendanceEvent(data) {
  console.log('Received attendance event:', data); // Debug log

  // Create a unique key for this event based on user and timestamp
  const userId = data.userId || data.biometricDeviceId || 'unknown';
  const eventTime = new Date(data.checkInTime || data.timestamp || data.recordTime || new Date());
  const eventKey = `${userId}-${Math.floor(eventTime.getTime() / 1000)}`; // Round to nearest second

  const now = Date.now();

  // Check if this is a duplicate event
  if (recentEvents.has(eventKey)) {
    const eventAge = now - recentEvents.get(eventKey);
    if (eventAge < DUPLICATE_WINDOW) {
      console.log('⚠️ Duplicate event detected and ignored:', { userId, eventKey, eventAge });
      return; // Skip this duplicate event
    }
  }

  // Store this event in the recent events map
  recentEvents.set(eventKey, now);

  // Clean up old entries from the map (older than DUPLICATE_WINDOW)
  for (const [key, timestamp] of recentEvents.entries()) {
    if (now - timestamp > DUPLICATE_WINDOW) {
      recentEvents.delete(key);
    }
  }

  // Get user info for sound notification
  const userName = data.name || `User ${userId}`;
  const userStatus = data.membershipStatus || data.status || 'active';
  const membershipEndDate = data.membershipEndDate || data.membershipEnd || null;

  // Play sound and speak welcome message
  if (userStatus === 'unknown') {
    playErrorBeep();
  } else {
    playSuccessBeep();
  }

  // Speak welcome message (slight delay to let beep finish)
  setTimeout(() => {
    speakWelcome(userName, userStatus, membershipEndDate);
  }, 200);

  // Remove empty state if present
  const emptyState = eventsContainer.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  // Create event element
  const eventEl = document.createElement('div');
  eventEl.className = 'event-item';

  // Handle both old format (timestamp/recordTime) and new format (checkInTime)
  const timestamp = new Date(data.checkInTime || data.timestamp || data.recordTime || new Date());
  const timeStr = timestamp.toLocaleTimeString();
  const dateStr = timestamp.toLocaleDateString();

  // Determine badge based on status
  let statusBadge, statusColor;
  if (userStatus === 'unknown') {
    statusBadge = '<span class="badge badge-error">Unknown User</span>';
    statusColor = '#ef4444';
  } else if (userStatus === 'active' || userStatus === 'present') {
    statusBadge = '<span class="badge badge-success">Active Member</span>';
    statusColor = '#10b981';
  } else {
    statusBadge = '<span class="badge badge-warning">Membership Expired</span>';
    statusColor = '#f59e0b';
  }

  // Calculate membership expiration info
  let membershipInfo = '';
  if (membershipEndDate && userStatus !== 'unknown') {
    const endDate = new Date(membershipEndDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    endDate.setHours(0, 0, 0, 0);
    const daysRemaining = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));

    if (daysRemaining >= 0) {
      if (daysRemaining === 0) {
        membershipInfo = '<span style="color: #ef4444; font-weight: 600;">Expires Today</span>';
      } else if (daysRemaining === 1) {
        membershipInfo = '<span style="color: #f59e0b; font-weight: 600;">Expires Tomorrow</span>';
      } else if (daysRemaining <= 7) {
        membershipInfo = `<span style="color: #f59e0b; font-weight: 600;">${daysRemaining} Days Remaining</span>`;
      } else if (daysRemaining <= 30) {
        membershipInfo = `<span style="color: #10b981;">${daysRemaining} Days Remaining</span>`;
      } else {
        membershipInfo = `<span style="color: #6b7280;">${endDate.toLocaleDateString()}</span>`;
      }
    } else {
      const daysExpired = Math.abs(daysRemaining);
      membershipInfo = `<span style="color: #ef4444; font-weight: 600;">Expired ${daysExpired} ${daysExpired === 1 ? 'Day' : 'Days'} Ago</span>`;
    }
  }

  // Get initials for placeholder
  const initials = userName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  eventEl.innerHTML = `
    <div class="event-header">
      <div class="event-profile">
        <div class="event-profile-placeholder">${initials}</div>
      </div>
      <div class="event-info">
        <div class="event-user">${userName}</div>
        <div class="event-time">⏰ ${timeStr} • ${dateStr}</div>
        <div>${statusBadge}</div>
      </div>
    </div>
    <div class="event-details">
      <div class="event-detail">
        <div class="event-detail-label">Biometric ID</div>
        <div class="event-detail-value">${data.biometricDeviceId || 'N/A'}</div>
      </div>
      ${data.membershipPlanId ? `
      <div class="event-detail">
        <div class="event-detail-label">Plan ID</div>
        <div class="event-detail-value">${data.membershipPlanId}</div>
      </div>` : ''}
      ${membershipInfo ? `
      <div class="event-detail">
        <div class="event-detail-label">Membership</div>
        <div class="event-detail-value">${membershipInfo}</div>
      </div>` : ''}
      <div class="event-detail">
        <div class="event-detail-label">Source</div>
        <div class="event-detail-value">${data.source || 'essl'}</div>
      </div>
    </div>
  `;

  // Add to top of list
  eventsContainer.insertBefore(eventEl, eventsContainer.firstChild);

  // Update statistics
  totalEvents++;
  const today = new Date().toDateString();
  if (timestamp.toDateString() === today) {
    todayEvents++;
  }
  updateStats();

  // Keep only last 100 events
  const events = eventsContainer.querySelectorAll('.event-item');
  if (events.length > 100) {
    events[events.length - 1].remove();
  }

  footerStatus.textContent = `Latest: ${userName} at ${timeStr}`;
}

// Update Statistics
function updateStats() {
  totalEventsEl.textContent = totalEvents;
  todayEventsEl.textContent = todayEvents;
}

// Update System Status Checklist
function updateSystemStatus(component, status) {
  systemStatus[component] = status;

  const elements = {
    server: checkServer,
    database: checkDatabase,
    device: checkDevice,
    socket: checkSocket
  };

  const element = elements[component];
  if (!element) return;

  // Remove existing status classes
  element.classList.remove('pending', 'success', 'error');

  // Add new status class
  if (status === true) {
    element.classList.add('success');
  } else if (status === false) {
    element.classList.add('pending');
  } else if (status === 'error') {
    element.classList.add('error');
  }

  // Update icon SVG based on status
  const iconSpan = element.querySelector('.check-icon');
  const label = element.querySelector('.check-label');

  let iconSVG = '';
  if (status === true) {
    // Success - Checkmark icon
    iconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;
  } else if (status === 'error') {
    // Error - X icon
    iconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/>
      <line x1="9" y1="9" x2="15" y2="15"/>
    </svg>`;
  } else {
    // Pending/Loading - Spinner icon
    iconSVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 6v6l4 2"/>
    </svg>`;
  }

  if (iconSpan) {
    iconSpan.innerHTML = iconSVG;
  }

  // Support custom status messages
  if (typeof status === 'string' && status !== 'error') {
    // Custom status message (e.g., "Searching...", "Connecting...")
    if (label) {
      label.textContent = status;
    }
    element.classList.add('pending');
    checkSystemReady();
    return;
  }

  const labels = {
    server: status === true ? 'Running' : status === 'error' ? 'Error' : 'Starting',
    database: status === true ? 'Connected' : status === 'error' ? 'Error' : 'Connecting',
    device: status === true ? 'Connected' : status === 'error' ? 'Not Found' : 'Searching',
    socket: status === true ? 'Active' : status === 'error' ? 'Error' : 'Connecting'
  };

  if (label) {
    label.textContent = labels[component];
  }

  // Check if system is ready
  checkSystemReady();
}

// Check if all systems are ready
function checkSystemReady() {
  const allReady = systemStatus.server && systemStatus.database && systemStatus.device && systemStatus.socket;
  const anyError = Object.values(systemStatus).includes('error');

  const indicator = readyStatus.querySelector('.ready-indicator');
  const statusText = indicator.querySelector('span');
  const statusIcon = indicator.querySelector('svg');

  if (allReady) {
    indicator.className = 'ready-indicator ready';
    statusIcon.innerHTML = '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>';
    statusText.textContent = 'System Ready - Start Scanning!';
    footerStatus.textContent = 'System is ready';
  } else if (anyError) {
    indicator.className = 'ready-indicator error';
    statusIcon.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
    statusText.textContent = 'System Error - Check Logs';
  } else {
    indicator.className = 'ready-indicator waiting';
    statusIcon.innerHTML = '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>';
    statusText.textContent = 'Initializing System...';
  }
}

// Update sync status display
async function updateSyncStatus() {
  if (!window.electronAPI || !window.electronAPI.getSyncStatus) {
    return;
  }

  try {
    const result = await window.electronAPI.getSyncStatus();
    if (!result.success) return;

    const { status } = result;
    const isOnline = status.isOnline;
    const pendingRecords = status.pendingRecords || 0;

    // Update sync header
    const syncIcon = offlineSyncStatus.querySelector('.sync-icon');
    const syncText = offlineSyncStatus.querySelector('.sync-text');

    if (isOnline) {
      offlineSyncStatus.classList.remove('offline');
      syncIcon.textContent = '🌐';
      syncIcon.classList.remove('offline');
      syncText.textContent = 'Online';
    } else {
      offlineSyncStatus.classList.add('offline');
      syncIcon.textContent = '📴';
      syncIcon.classList.add('offline');
      syncText.textContent = 'Offline';
    }

    // Update pending count
    const pendingCount = syncDetails.querySelector('.pending-count');
    if (pendingRecords > 0) {
      pendingCount.textContent = `${pendingRecords} pending record${pendingRecords > 1 ? 's' : ''}`;
      forceSyncBtn.style.display = isOnline ? 'block' : 'none';
    } else {
      pendingCount.textContent = 'All synced';
      forceSyncBtn.style.display = 'none';
    }

    // Show sync status if there are pending records
    if (status.isSyncing) {
      syncText.textContent = 'Syncing...';
    }
  } catch (error) {
    console.error('Failed to update sync status:', error);
  }
}

// Handle force sync
async function handleForceSync() {
  if (!window.electronAPI || !window.electronAPI.forceSync) {
    return;
  }

  try {
    forceSyncBtn.disabled = true;
    forceSyncBtn.textContent = 'Syncing...';

    const result = await window.electronAPI.forceSync();

    if (result.success) {
      console.log('Sync completed:', result.results);
      await updateSyncStatus();
    } else {
      console.error('Sync failed:', result.error);
    }
  } catch (error) {
    console.error('Force sync error:', error);
  } finally {
    forceSyncBtn.disabled = false;
    forceSyncBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
      </svg>
      Sync Now
    `;
  }
}

// Set up sync status monitoring
function setupSyncMonitoring() {
  // Update sync status every 10 seconds
  setInterval(updateSyncStatus, 10000);

  // Initial update
  updateSyncStatus();

  // Add force sync button handler
  if (forceSyncBtn) {
    forceSyncBtn.addEventListener('click', handleForceSync);
  }
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);
