// Tauri API Shim
// Replaces the Electron preload script mechanism
const API_URL = 'http://localhost:5001';

// Event emitter for simulating IPC events
class EventEmitter {
  constructor() {
    this.events = {};
  }
  on(event, listener) {
    if (!this.events[event]) this.events[event] = [];
    this.events[event].push(listener);
  }
  emit(event, data) {
    if (this.events[event]) this.events[event].forEach(l => l(data));
  }
}

const ipcBus = new EventEmitter();

// Listen for Tauri events (if any)
if (window.__TAURI__) {
   const { listen } = window.__TAURI__.event;
   listen('server-ready', (event) => {
       console.log('Tauri: Server ready');
       ipcBus.emit('server-started', { port: 5001 });
   });
}

// Global API object
window.electronAPI = {
  getConfig: async () => {
    const res = await fetch(`${API_URL}/config`);
    const data = await res.json();
    return data.config;
  },
  
  scanNetwork: async () => {
    // Notify scan started
    ipcBus.emit('scan-started');
    
    try {
      const res = await fetch(`${API_URL}/device/scan`);
      const data = await res.json();
      
      // Simulate events based on result
      if (data.success && data.devices.length > 0) {
          // We found devices (maybe multiple), but let's say we discovered the first one
          // Or just return the list. renderer.js expects a list from 'scan-network' usually?
          // Wait, renderer.js expects 'get-config' etc.
          // Let's look at how renderer.js uses it.
          // window.electronAPI.onDeviceDiscovered
          data.devices.forEach(d => {
             ipcBus.emit('device-discovered', { ip: d.ip }); 
          });
      } else {
          ipcBus.emit('device-not-found', { suggestions: ['Check network'] });
      }
      return data; // renderer.js might await this too if it calls invoke('scan-network')
    } catch (e) {
      ipcBus.emit('scan-failed', { error: e.message });
      throw e;
    }
  },
  
  reconnect: async () => {
      try {
        const res = await fetch(`${API_URL}/reconnect`);
        const data = await res.json();
        return data; 
      } catch (e) {
          return { success: false, error: e.message };
      }
  },
  
  connectToIP: async (ip) => {
      // Notify connecting
      ipcBus.emit('connecting', { ip, isMock: false });
      
      try {
          const res = await fetch(`${API_URL}/device/connect`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ip })
          });
          const data = await res.json();
          if (data.success) {
              ipcBus.emit('device-connected', { ip });
          } else {
              ipcBus.emit('connection-failed', { ip, error: data.error });
          }
          return data;
      } catch (e) {
          ipcBus.emit('connection-failed', { ip, error: e.message });
          return { success: false, error: e.message };
      }
  },
  
  // Sync status
  getSyncStatus: async () => {
      const res = await fetch(`${API_URL}/sync/status`);
      return (await res.json()).status;
  },
  forceSync: async () => {
       const res = await fetch(`${API_URL}/sync/force`, { method: 'POST' });
       return await res.json();
  },
  getOfflineStats: async () => {
       const res = await fetch(`${API_URL}/stats/offline`);
       return (await res.json()).stats;
  },
  
  // Event Listeners (Bridge to ipcBus)
  onServerStarted: (cb) => ipcBus.on('server-started', cb),
  onScanStarted: (cb) => ipcBus.on('scan-started', cb),
  onDeviceDiscovered: (cb) => ipcBus.on('device-discovered', cb),
  onDeviceNotFound: (cb) => ipcBus.on('device-not-found', cb),
  onScanFailed: (cb) => ipcBus.on('scan-failed', cb),
  onConnecting: (cb) => ipcBus.on('connecting', cb),
  onDeviceConnected: (cb) => ipcBus.on('device-connected', cb),
  onConnectionFailed: (cb) => ipcBus.on('connection-failed', cb),
  onLogMessage: (cb) => {
      // Logs primarily come via socket.io, but if we need to emit local logs
      ipcBus.on('log-message', cb);
  }
};

// Initial signals
setTimeout(() => {
    // Simulate server started since sidecar runs on launch
    ipcBus.emit('server-started', { port: 5001 });
}, 1000);
