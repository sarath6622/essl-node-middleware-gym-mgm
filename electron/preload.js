// Preload Script
// Secure bridge between main and renderer processes

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Get configuration
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // Scan network for devices
  scanNetwork: () => ipcRenderer.invoke('scan-network'),
  
  // Get connection status
  getStatus: () => ipcRenderer.invoke('get-status'),
  
  // Reconnect to device
  reconnect: () => {
    return ipcRenderer.invoke('reconnect');
  },
  
  connectToIP: (ip) => {
    return ipcRenderer.invoke('connect-to-ip', ip);
  },
  
  // Listen to events from main process
  onServerStarted: (callback) => {
    ipcRenderer.on('server-started', (event, data) => callback(data));
  },
  
  onScanStarted: (callback) => {
    ipcRenderer.on('scan-started', () => callback());
  },
  
  onDeviceDiscovered: (callback) => {
    ipcRenderer.on('device-discovered', (event, data) => callback(data));
  },
  
  onDeviceNotFound: (callback) => {
    ipcRenderer.on('device-not-found', (event, data) => callback(data));
  },
  
  onScanFailed: (callback) => {
    ipcRenderer.on('scan-failed', (event, data) => callback(data));
  },
  
  onConnecting: (callback) => {
    ipcRenderer.on('connecting', (event, data) => callback(data));
  },
  
  onDeviceConnected: (callback) => {
    ipcRenderer.on('device-connected', (event, data) => callback(data));
  },
  
  onConnectionFailed: (callback) => {
    ipcRenderer.on('connection-failed', (event, data) => callback(data));
  },
  
  onLogMessage: (callback) => {
    ipcRenderer.on('log-message', (event, data) => callback(data));
  }
});
