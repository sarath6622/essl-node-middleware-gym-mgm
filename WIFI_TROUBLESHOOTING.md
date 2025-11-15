# WiFi Connectivity Troubleshooting Guide

## Problem: Laptop on WiFi Cannot Connect to Fingerprint Device

### Symptoms
- ✅ PC on Ethernet can connect to device at 192.168.1.74
- ❌ Laptop on WiFi cannot find or connect to device
- ❌ Network scan finds no devices on laptop

---

## Root Causes & Solutions

### 1️⃣ AP Isolation / Client Isolation (Most Common)

**What it is:** WiFi router prevents wireless clients from communicating with each other or with wired devices.

**How to fix:**

1. **Access your router settings**
   - Open browser: `http://192.168.1.1` or `http://192.168.0.1`
   - Login with admin credentials

2. **Find AP Isolation setting** (different routers use different names):
   - **TP-Link**: Wireless Settings → Wireless Advanced → Enable AP Isolation (DISABLE this)
   - **D-Link**: Advanced → Advanced Wireless → Enable Wireless Isolation (DISABLE this)
   - **Netgear**: Wireless Settings → Enable Wireless Isolation (UNCHECK this)
   - **Asus**: Wireless → Professional → Set AP Isolated to "No"
   - **Linksys**: Wireless → Advanced Wireless Settings → AP Isolation (DISABLE)

3. **Save and Reboot Router**

---

### 2️⃣ Different Network Segments

**Check if laptop and device are on same network:**

```powershell
# On laptop, check IP
ipconfig
```

**Expected:**
- Laptop: `192.168.1.X` ✅
- Device: `192.168.1.74` ✅
- **Same subnet!**

**If different (e.g., laptop is `192.168.0.X`):**
- Your router has separate networks for WiFi and Ethernet
- **Solution:** Connect laptop to Ethernet, OR configure router to use same subnet

---

### 3️⃣ Windows Firewall Blocking Port 4370

**On laptop, run PowerShell as Administrator:**

```powershell
# Add firewall rule to allow port 4370
New-NetFirewallRule -DisplayName "ZK Attendance Device" -Direction Inbound -Protocol TCP -LocalPort 4370 -Action Allow

# Also allow outbound
New-NetFirewallRule -DisplayName "ZK Attendance Device Out" -Direction Outbound -Protocol TCP -RemotePort 4370 -Action Allow
```

---

### 4️⃣ Test Connectivity

**After fixing, test on laptop:**

```powershell
# Test if you can reach the device
Test-NetConnection -ComputerName 192.168.1.74 -Port 4370

# Expected output:
# TcpTestSucceeded : True ✅
```

**Then run the app:**
```powershell
npm run electron
```

---

## Quick Checklist

- [ ] Laptop and device on same subnet (192.168.1.x)
- [ ] AP Isolation is DISABLED on router
- [ ] Can ping device: `ping 192.168.1.74`
- [ ] Port 4370 is reachable: `Test-NetConnection`
- [ ] Windows Firewall allows port 4370
- [ ] Router firewall not blocking inter-VLAN traffic

---

## Alternative Solutions

### Option A: Use Mobile Hotspot (Quick Test)
1. On PC with Ethernet connection, enable Mobile Hotspot
2. Connect laptop to PC's hotspot
3. Both will be on same network, no isolation

### Option B: Connect Laptop to Ethernet
- Use USB-to-Ethernet adapter
- Guarantees same network as PC

### Option C: Configure Static IP on Device
1. Set device to static IP in router's Ethernet range
2. Update app config to use that static IP
3. Disable auto-discovery

---

## Still Not Working?

### Advanced Diagnostics

**On laptop, run this to scan for any device on port 4370:**

```powershell
# Install nmap (optional)
# Or use built-in PowerShell

1..254 | ForEach-Object {
    $ip = "192.168.1.$_"
    $result = Test-NetConnection -ComputerName $ip -Port 4370 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($result) {
        Write-Host "Found device at $ip" -ForegroundColor Green
    }
}
```

This will scan entire 192.168.1.0/24 subnet for any device listening on port 4370.

---

## Contact Info

If none of these solutions work, check:
1. Router model and firmware version
2. Network topology (mesh network, extenders, multiple access points)
3. Enterprise network with VLANs
4. MAC filtering enabled on router
