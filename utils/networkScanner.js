// networkScanner.js
// Cross-platform network scanner for ZK/eSSL fingerprint devices
// Scans local /24 subnet for devices with TCP port 4370 open

const os = require('os');
const net = require('net');
const { exec } = require('child_process');
const { promisify } = require('util');
const log = require('./logger');
const ZKLib = require('zkteco-js');
const execp = promisify(exec);
const EventEmitter = require('events');

// Increase default max listeners globally to prevent warnings
EventEmitter.defaultMaxListeners = 100;

const PORT = 4370;               // eSSL/ZK default comm port
const CONNECT_TIMEOUT = 400;     // ms per connection (reduced from 600)
const CONCURRENCY = 150;         // number of simultaneous sockets (increased from 120)

/**
 * Get all non-internal IPv4 addresses
 * @returns {string[]} Array of IP addresses
 */
function getAllIPv4Addresses() {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name]) {
      if (info.family === 'IPv4' && !info.internal) {
        // ignore link-local 169.254.x.x
        if (!info.address.startsWith('169.254')) {
          addresses.push(info.address);
        }
      }
    }
  }
  return addresses;
}

/**
 * Get the primary non-internal IPv4 address
 * @returns {string|null} IP address or null if not found
 */
function getPrimaryIPv4() {
  const addresses = getAllIPv4Addresses();
  return addresses.length > 0 ? addresses[0] : null;
}

/**
 * Extract the network prefix from an IP address
 * @param {string} ip - IP address (e.g., "192.168.1.45")
 * @returns {string|null} Network prefix (e.g., "192.168.1.") or null
 */
function ipToBase(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.`;
}

/**
 * Attempt to connect to a specific IP and port
 * @param {string} ip - IP address to scan
 * @param {number} port - Port number to check
 * @param {number} timeout - Connection timeout in ms
 * @returns {Promise<{ip: string, open: boolean}>}
 */
function scanPort(ip, port, timeout = CONNECT_TIMEOUT) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    socket.setTimeout(timeout);

    socket.once('connect', () => {
      done = true;
      socket.destroy();
      resolve({ ip, open: true });
    });

    socket.once('timeout', () => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve({ ip, open: false });
      }
    });

    socket.once('error', () => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve({ ip, open: false });
      }
    });

    socket.connect(port, ip);
  });
}

/**
 * Get smart IP range based on local IP
 * Prioritizes likely device IPs (skips common router/gateway IPs)
 * @param {string} prefix - Network prefix (e.g., "192.168.1.")
 * @param {string} localIP - Local machine IP
 * @returns {number[]} Array of host numbers to scan
 */
function getSmartScanRange(prefix, localIP) {
  const localHostNum = parseInt(localIP.split('.')[3]);
  const skipIPs = new Set([1, 255]); // Skip gateway and broadcast

  const priority = [];
  const secondary = [];

  for (let i = 2; i <= 254; i++) {
    if (skipIPs.has(i) || i === localHostNum) continue;

    // Prioritize common device IP ranges (100-200)
    if (i >= 100 && i <= 200) {
      priority.push(i);
    } else {
      secondary.push(i);
    }
  }

  // Scan priority range first, then secondary
  return [...priority, ...secondary];
}

/**
 * Scan the entire /24 subnet for open ports with optimizations
 * @param {string} prefix - Network prefix (e.g., "192.168.1.")
 * @param {string} localIP - Local IP for smart range detection
 * @returns {Promise<string[]>} Array of IP addresses with open ports
 */
async function runPingSweepByTCP(prefix, localIP = null) {
  // Use smart range if local IP provided
  const scanOrder = localIP
    ? getSmartScanRange(prefix, localIP)
    : Array.from({ length: 253 }, (_, i) => i + 2); // 2-254

  const ips = scanOrder.map(n => prefix + n);
  const results = [];
  let idx = 0;
  let foundCount = 0;
  const MAX_DEVICES = 5; // Stop after finding 5 devices (most networks have 1-2)

  async function worker() {
    while (true) {
      // Early exit if we found enough devices
      if (foundCount >= MAX_DEVICES) break;

      let cur = ips[idx++];
      if (!cur) break;

      const res = await scanPort(cur, PORT);
      if (res.open) {
        results.push(res.ip);
        foundCount++;

        // Early exit optimization - if we found a device, likely found all
        if (foundCount >= MAX_DEVICES) break;
      }
    }
  }

  // spawn concurrent workers
  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  return results;
}

/**
 * Get the system ARP table
 * @returns {Promise<string>} Raw ARP table output
 */
async function getArpTable() {
  try {
    // 'arp -a' works on Windows/macOS/Linux
    const { stdout } = await execp('arp -a');
    return stdout;
  } catch (e) {
    return '';
  }
}

/**
 * Parse ARP table output to extract IP -> MAC mappings
 * @param {string} arpOut - Raw ARP table output
 * @returns {Map<string, string>} Map of IP addresses to MAC addresses
 */
function parseArp(arpOut) {
  const map = new Map();
  const lines = arpOut.split(/\r?\n/);
  const ipv4Regex = /(\d{1,3}(?:\.\d{1,3}){3})/;
  const macRegex = /([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/;
  
  for (const line of lines) {
    const ipMatch = line.match(ipv4Regex);
    const macMatch = line.match(macRegex);
    
    if (ipMatch && macMatch) {
      const ip = ipMatch[1];
      let mac = macMatch[0].toLowerCase();
      // normalize to colon separated
      mac = mac.replace(/-/g, ':');
      map.set(ip, mac);
    }
    
    // Handle Linux 'ip neigh' style with 'lladdr'
    if (!ipMatch && line.includes('lladdr')) {
      const parts = line.trim().split(/\s+/);
      const ip2 = parts[0];
      const llidx = parts.indexOf('lladdr');
      if (llidx >= 0 && parts[llidx + 1]) {
        let mac2 = parts[llidx + 1].toLowerCase().replace(/-/g, ':');
        if (ip2.match(ipv4Regex)) {
          map.set(ip2, mac2);
        }
      }
    }
  }
  
  return map;
}

/**
 * Get device info from a specific IP with timeout
 * @param {string} ip - IP address of device
 * @param {number} port - Port number
 * @param {number} timeout - Info retrieval timeout in ms
 * @returns {Promise<{name: string, serialNumber: string}|null>}
 */
async function getDeviceInfo(ip, port, timeout = 3000) {
  let zk = null;
  let socketCreated = false;

  // Wrap in timeout promise
  const timeoutPromise = new Promise((resolve) => {
    setTimeout(() => resolve({
      name: `ZK Device (${ip.split('.').pop()})`,
      serialNumber: 'Unknown',
      model: 'ZK Device',
      firmware: 'Timeout'
    }), timeout);
  });

  const infoPromise = (async () => {
    try {
      zk = new ZKLib(ip, port, 3000, 1500); // Reduced timeouts
      await zk.createSocket();
      socketCreated = true;

      // Increase max listeners to prevent warnings
      if (zk.socket && zk.socket.setMaxListeners) {
        zk.socket.setMaxListeners(100);
      }

      const info = await zk.getInfo();

      // Extract device name and serial number
      const name = info.name || info.deviceName || `Device ${ip.split('.').pop()}`;
      const serialNumber = info.serialNumber || info.fwVersion || 'Unknown';

      return {
        name,
        serialNumber,
        model: info.platform || 'ZK Device',
        firmware: info.fwVersion || 'Unknown'
      };
    } catch (error) {
      // If we can't get info, return default
      return {
        name: `ZK Device (${ip.split('.').pop()})`,
        serialNumber: 'Unknown',
        model: 'Unknown',
        firmware: 'Unknown'
      };
    } finally {
      // Cleanup: Only try to disconnect if socket was created
      if (zk && socketCreated) {
        try {
          // Destroy socket directly to avoid write-after-end errors
          if (zk.socket && !zk.socket.destroyed) {
            zk.socket.removeAllListeners();
            zk.socket.destroy();
          }
        } catch (e) {
          // Silently ignore cleanup errors
        }
      }
    }
  })();

  return Promise.race([infoPromise, timeoutPromise]);
}

/**
 * Scan the local network for ZK/eSSL fingerprint devices
 * @param {boolean} verbose - Whether to log detailed information
 * @returns {Promise<Array<{ip: string, port: number, mac: string|null, name: string, serialNumber: string}>>} Array of discovered devices
 */
async function scanForDevices(verbose = true) {
  try {
    if (verbose) {
      log('info', '🔍 Detecting network addresses...');
    }

    const myip = getPrimaryIPv4();
    if (!myip) {
      if (verbose) {
        log('error', 'Could not detect a non-internal IPv4 address. Ensure you are connected to the network.');
      }
      return [];
    }

    if (verbose) {
      log('info', `Local IP: ${myip}`);
    }

    // Collect network ranges to scan
    const networksToScan = [];

    // Add current network
    const prefix = ipToBase(myip);
    if (prefix) {
      networksToScan.push({ prefix, ip: myip, label: 'current network' });
    }

    // Always add common 192.168 ranges (WiFi networks)
    const common192Ranges = ['192.168.0.', '192.168.1.', '192.168.2.'];
    for (const range of common192Ranges) {
      // Only add if not already in the list
      if (!networksToScan.some(net => net.prefix === range)) {
        networksToScan.push({ prefix: range, ip: null, label: 'WiFi network' });
      }
    }

    if (verbose) {
      log('info', `Scanning ${networksToScan.length} network range(s) for devices on port ${PORT}...`);
      networksToScan.forEach(net => {
        log('info', `  • ${net.prefix}0/24 (${net.label})`);
      });
      log('info', 'Using smart scan prioritization for faster results...');
    }

    // Scan all networks in parallel
    const scanPromises = networksToScan.map(net =>
      runPingSweepByTCP(net.prefix, net.ip)
    );

    const scanResults = await Promise.all(scanPromises);
    const openHosts = [...new Set(scanResults.flat())]; // Remove duplicates
  
  if (openHosts.length === 0) {
    if (verbose) {
      log('warn', `No devices with port ${PORT} found on any scanned network`);
      log('info', 'If the device is on a different VLAN or client-isolation is enabled, check the router/hotspot DHCP list.');
    }
    return [];
  }
  
  if (verbose) {
    log('success', `Found ${openHosts.length} device(s) with port ${PORT} open:`);
    openHosts.forEach(ip => log('info', `  • ${ip}`));
  }
  
  // Query ARP table for MAC addresses
  if (verbose) {
    log('info', 'Querying ARP table for MAC addresses...');
  }
  
  const arpRaw = await getArpTable();
  const arpMap = parseArp(arpRaw);
  
  // Query device info from each device
  if (verbose) {
    log('info', 'Retrieving device information...');
  }
  
  const devices = await Promise.all(
    openHosts.map(async (ip) => {
      const deviceInfo = await getDeviceInfo(ip, PORT);
      return {
        ip,
        port: PORT,
        mac: arpMap.get(ip) || null,
        name: deviceInfo.name,
        serialNumber: deviceInfo.serialNumber,
        model: deviceInfo.model,
        firmware: deviceInfo.firmware
      };
    })
  );
  
  if (verbose) {
    log('success', '\n📋 Discovered Devices:');
    devices.forEach(device => {
      const macInfo = device.mac || '(MAC not in ARP table)';
      log('info', `  • ${device.name} | IP: ${device.ip}:${device.port} | MAC: ${macInfo}`);
    });
  }
  
  return devices;
  } catch (error) {
    if (verbose) {
      log('error', `Network scan failed: ${error.message}`);
      console.error('Scan error stack:', error.stack);
    }
    return [];
  }
}

/**
 * Find the first available ZK/eSSL device on the network
 * @param {boolean} verbose - Whether to log detailed information
 * @returns {Promise<string|null>} IP address of the first device found, or null
 */
async function findFirstDevice(verbose = true) {
  const devices = await scanForDevices(verbose);
  if (devices.length > 0) {
    return devices[0].ip;
  }
  return null;
}

module.exports = {
  scanForDevices,
  findFirstDevice,
  getPrimaryIPv4,
  PORT
};
