const DEVICE_CONFIG = {
  // Set to true to use the mock device service for development without a physical device.
  useMockDevice: false,
  mockInterval: 15000, // 15 seconds

  // Auto-discovery settings
  autoDiscoverDevice: true, // <-- Set to false to use static IP (faster, more reliable)
  autoDiscoveryRetries: 5, // <-- Just 1 attempt for quick scan
  autoDiscoveryRetryDelay: 3000, // <-- Reduced to 3 seconds between retries

  // Real device IP configuration (only used if useMockDevice is false and autoDiscoverDevice is false)
  ip: "192.168.1.74", // <-- Static IP - device confirmed reachable via Test-NetConnection
  port: 4370,
  timeout: 10000,
  inactivityTimeout: 4000,

  // Network scanning settings (for auto-discovery)
  scanTimeout: 600,      // ms per connection attempt during scan
  scanConcurrency: 120,  // number of simultaneous connections during scan

  // Timezone configuration for attendance date calculation
  timezone: "Asia/Kolkata", // IST (UTC+5:30)
};

module.exports = DEVICE_CONFIG;
