# Feature: Auto-Discovery with Retry Logic

## Overview

The device auto-discovery now includes **configurable retry logic** to handle cases where the device might not be immediately available on the network (e.g., device booting up, temporary network issues).

---

## Configuration

**File:** [config/deviceConfig.js](config/deviceConfig.js)

```javascript
const DEVICE_CONFIG = {
  // Auto-discovery settings
  autoDiscoverDevice: true,           // Enable auto-discovery
  autoDiscoveryRetries: 10,           // Number of retry attempts (default: 10)
  autoDiscoveryRetryDelay: 5000,      // Delay between retries in ms (default: 5 seconds)

  // ... other settings
};
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `autoDiscoveryRetries` | number | 10 | Number of scan attempts before giving up |
| `autoDiscoveryRetryDelay` | number | 5000 | Milliseconds to wait between retry attempts |

---

## Behavior

### When Device is Found

```
🔍 Auto-discovery enabled. Scanning network for fingerprint device...
🔍 Scanning network (attempt 1/10)...
✅ Device discovered at 192.168.1.14 on attempt 1/10
```

**Result:** Continues with normal startup

---

### When Device is Not Found Immediately

```
🔍 Auto-discovery enabled. Scanning network for fingerprint device...
🔍 Scanning network (attempt 1/10)...
⚠️ No device found on attempt 1/10
🔄 Retry attempt 2/10 - Scanning again in 5 seconds...
🔍 Scanning network (attempt 2/10)...
⚠️ No device found on attempt 2/10
🔄 Retry attempt 3/10 - Scanning again in 5 seconds...
🔍 Scanning network (attempt 3/10)...
✅ Device discovered at 192.168.1.14 on attempt 3/10
```

**Result:** Device found on retry, continues with normal startup

---

### When Device Never Found

```
🔍 Auto-discovery enabled. Scanning network for fingerprint device...
🔍 Scanning network (attempt 1/10)...
⚠️ No device found on attempt 1/10
🔄 Retry attempt 2/10 - Scanning again in 5 seconds...
...
🔍 Scanning network (attempt 10/10)...

❌ No device found after 10 attempts!
Connection unsuccessful. Please ensure:
  1. The fingerprint device is powered on
  2. The device is connected to the same network
  3. No firewall is blocking port 4370
  4. AP/Client isolation is disabled on your router

💡 You can:
  • Check your router's DHCP/connected devices list
  • Manually scan again: GET http://localhost:5001/device/scan
  • Set autoDiscoverDevice: false in config and use a static IP
  • Increase autoDiscoveryRetries in config (current: 10)
```

**Result:** Server starts without device connection, can manually scan later

---

## Use Cases

### 1. Device Takes Time to Boot

**Scenario:** ZK device boots up slower than the server

**Solution:** Retries give the device time to fully boot and appear on the network

```javascript
autoDiscoveryRetries: 15,      // Try for ~75 seconds
autoDiscoveryRetryDelay: 5000  // 5 seconds between attempts
```

---

### 2. Temporary Network Issues

**Scenario:** Network switches/routers experience brief delays

**Solution:** Retries handle transient network issues

```javascript
autoDiscoveryRetries: 5,       // Quick retries
autoDiscoveryRetryDelay: 3000  // 3 seconds between attempts
```

---

### 3. Device on WiFi (Slower Connection)

**Scenario:** Device connects via WiFi with variable latency

**Solution:** More retries with longer delays

```javascript
autoDiscoveryRetries: 20,      // More attempts
autoDiscoveryRetryDelay: 10000 // 10 seconds between attempts
```

---

## Performance Considerations

### Total Discovery Time

**Formula:** `(retries × retryDelay) + (scanTime × retries)`

**Examples:**

| Retries | Delay | Scan Time | Total Time |
|---------|-------|-----------|------------|
| 10 | 5s | 2s | ~70 seconds max |
| 5 | 3s | 2s | ~25 seconds max |
| 20 | 10s | 2s | ~240 seconds max |

**Note:** Discovery stops immediately when device is found, so these are worst-case times.

---

## Optimization Tips

### Fast Discovery (Device Usually Available)

```javascript
autoDiscoveryRetries: 3,       // Quick give-up
autoDiscoveryRetryDelay: 2000  // 2 seconds
```

**Total:** ~6-8 seconds if device not found

---

### Patient Discovery (Unreliable Network)

```javascript
autoDiscoveryRetries: 20,      // Very patient
autoDiscoveryRetryDelay: 10000 // 10 seconds
```

**Total:** ~3-4 minutes if device not found

---

### Recommended Settings

**Default (Balanced):**
```javascript
autoDiscoveryRetries: 10,      // 10 attempts
autoDiscoveryRetryDelay: 5000  // 5 seconds
```

**Total:** ~50-70 seconds max, good for most scenarios

---

## Manual Scan API

If auto-discovery gives up, you can trigger manual scans:

```bash
# Trigger new scan
curl http://localhost:5001/device/scan

# Then reconnect if device found
curl http://localhost:5001/reconnect
```

---

## Code Changes

### Files Modified

1. **config/deviceConfig.js** - Added retry configuration
   - Line 7: `autoDiscoveryRetries: 10`
   - Line 8: `autoDiscoveryRetryDelay: 5000`

2. **middleware.js** - Implemented retry loop
   - Lines 79-131: Retry logic with configurable attempts

---

## Logging

### Retry Progress

Each retry attempt logs:
- Current attempt number
- Total attempts
- Countdown timer
- Result (found/not found)

**Example:**
```
🔍 Scanning network (attempt 1/10)...
⚠️ No device found on attempt 1/10
🔄 Retry attempt 2/10 - Scanning again in 5 seconds...
```

### Verbose vs Quiet

- **First attempt:** Full verbose output (all scan details)
- **Retry attempts:** Quiet mode (minimal logging for cleaner output)

---

## Troubleshooting

### Too Many Retries (Slow Startup)

**Problem:** Server takes too long to start when device is offline

**Solution:** Reduce retries
```javascript
autoDiscoveryRetries: 3,  // Faster give-up
```

---

### Not Enough Retries (Device Misses)

**Problem:** Device appears on network after retries exhausted

**Solution:** Increase retries or delay
```javascript
autoDiscoveryRetries: 15,       // More attempts
autoDiscoveryRetryDelay: 10000  // Longer wait
```

---

### Network Too Slow

**Problem:** Each scan takes >5 seconds

**Solution:** Increase delay between retries
```javascript
autoDiscoveryRetryDelay: 15000  // 15 seconds
```

---

## Disable Auto-Discovery

If you prefer static IP:

```javascript
autoDiscoverDevice: false,  // Disable auto-discovery
ip: "192.168.1.14",        // Use static IP
```

**Benefits:**
- Instant startup (no scanning)
- Predictable behavior
- No network overhead

---

## Statistics

Monitor discovery attempts:

```bash
# Check server logs on startup
npm start

# Or check device status
curl http://localhost:5001/status
```

---

## Summary

✅ **10 retry attempts** by default (configurable)
✅ **5-second delay** between retries (configurable)
✅ **Smart logging** - verbose first, quiet on retries
✅ **Early exit** - stops immediately when device found
✅ **Helpful messages** - clear instructions if device not found
✅ **Total max time:** ~50-70 seconds for default config

**Result:** Handles temporary network issues and slow-booting devices automatically!
