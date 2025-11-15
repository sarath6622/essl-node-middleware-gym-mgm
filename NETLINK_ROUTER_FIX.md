# NetLink Router - WiFi Connectivity Fix

## Settings to Check

Based on your router screenshot, here are the settings to verify:

### 1. WLAN Basic (Current Page)
- [ ] "Disable WLAN Interface" should be **UNCHECKED** ✅ (Already correct)
- [ ] "Block WLAN Access to Web" should be **UNCHECKED** ✅ (Already correct)
- [ ] "Block Relay" should be **UNCHECKED** ✅ (Already correct in screenshot)

### 2. WLAN Advanced Settings (Check This Next!)
Go to **Network → WLAN → WLAN Advanced**

Look for these settings:
- **AP Isolation** - Must be **DISABLED** or **UNCHECKED**
- **Client Isolation** - Must be **DISABLED** or **UNCHECKED**
- **Wireless Isolation** - Must be **DISABLED** or **UNCHECKED**

### 3. WLAN Security
Go to **Network → WLAN → WLAN Security**

Ensure:
- WPA2-PSK or WPA3 is enabled (not open network)
- Check if there's any "Station Isolation" setting - disable it if present

## After Making Changes

1. Click **"Apply Changes"**
2. **Reboot Router**:
   - Go to Management → Reboot, OR
   - Unplug power, wait 10 seconds, plug back in
3. Reconnect to WiFi on your device
4. Test connectivity

## Test After Router Reboot

Run this PowerShell command:
```powershell
Test-NetConnection -ComputerName 192.168.1.74 -Port 4370
```

Expected result:
- TcpTestSucceeded : True ✅

Then run the app:
```powershell
npm run electron
```

## Still Not Working?

If the issue persists after checking WLAN Advanced settings:

1. Check if your router has **separate 2.4GHz and 5GHz networks**
   - Make sure your PC and fingerprint device are on the **same frequency band**
   - Fingerprint device is likely on 2.4GHz (if wireless) or Ethernet

2. **Check router firewall** (Security menu)
   - Look for any rules blocking port 4370
   - Temporarily disable firewall to test

3. **Factory reset router** (last resort)
   - This will clear all settings including potentially problematic rules
   - You'll need to reconfigure WiFi passwords
