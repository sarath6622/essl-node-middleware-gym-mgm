# ZK Attendance Device Network Diagnostic Script
# Run this on the laptop having connectivity issues

Write-Host "`n=== ZK Attendance Device Network Diagnostics ===" -ForegroundColor Cyan
Write-Host "This will help diagnose why your laptop can't connect to the fingerprint device`n" -ForegroundColor Yellow

$deviceIP = "192.168.1.74"
$devicePort = 4370

# Check 1: Network Adapter Info
Write-Host "[1/6] Checking network configuration..." -ForegroundColor Green
$networkInfo = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1"
}

Write-Host "`nYour IP Addresses:" -ForegroundColor White
$networkInfo | ForEach-Object {
    $adapter = Get-NetAdapter -InterfaceIndex $_.InterfaceIndex
    Write-Host "  • $($_.IPAddress) on $($adapter.InterfaceDescription)" -ForegroundColor Cyan

    # Check if on same subnet as device
    $laptopSubnet = ($_.IPAddress -split '\.')[0..2] -join '.'
    $deviceSubnet = ($deviceIP -split '\.')[0..2] -join '.'

    if ($laptopSubnet -eq $deviceSubnet) {
        Write-Host "    ✅ Same subnet as device ($deviceSubnet.x)" -ForegroundColor Green
    } else {
        Write-Host "    ❌ Different subnet! Device is on $deviceSubnet.x" -ForegroundColor Red
    }
}

# Check 2: Ping test
Write-Host "`n[2/6] Testing if device is reachable..." -ForegroundColor Green
$pingResult = Test-Connection -ComputerName $deviceIP -Count 2 -Quiet
if ($pingResult) {
    Write-Host "  ✅ Device responds to ping" -ForegroundColor Green
} else {
    Write-Host "  ❌ Device does not respond to ping" -ForegroundColor Red
    Write-Host "     Possible causes:" -ForegroundColor Yellow
    Write-Host "     - Device is powered off" -ForegroundColor Yellow
    Write-Host "     - AP Isolation enabled on router" -ForegroundColor Yellow
    Write-Host "     - Device on different network" -ForegroundColor Yellow
}

# Check 3: Port connectivity
Write-Host "`n[3/6] Testing port $devicePort connectivity..." -ForegroundColor Green
try {
    $portTest = Test-NetConnection -ComputerName $deviceIP -Port $devicePort -WarningAction SilentlyContinue
    if ($portTest.TcpTestSucceeded) {
        Write-Host "  ✅ Port $devicePort is reachable!" -ForegroundColor Green
    } else {
        Write-Host "  ❌ Port $devicePort is NOT reachable" -ForegroundColor Red
        Write-Host "     Possible causes:" -ForegroundColor Yellow
        Write-Host "     - Firewall blocking port $devicePort" -ForegroundColor Yellow
        Write-Host "     - Device not listening on this port" -ForegroundColor Yellow
        Write-Host "     - Network isolation enabled" -ForegroundColor Yellow
    }
} catch {
    Write-Host "  ❌ Cannot test port connectivity: $($_.Exception.Message)" -ForegroundColor Red
}

# Check 4: ARP Table
Write-Host "`n[4/6] Checking ARP table for device..." -ForegroundColor Green
$arpTable = arp -a | Select-String $deviceIP
if ($arpTable) {
    Write-Host "  ✅ Device found in ARP table:" -ForegroundColor Green
    Write-Host "     $arpTable" -ForegroundColor Cyan
} else {
    Write-Host "  ❌ Device NOT in ARP table" -ForegroundColor Red
    Write-Host "     This means your laptop hasn't communicated with the device yet" -ForegroundColor Yellow
}

# Check 5: Firewall Rules
Write-Host "`n[5/6] Checking Windows Firewall rules for port $devicePort..." -ForegroundColor Green
$firewallRule = Get-NetFirewallRule | Where-Object {
    $_.DisplayName -like "*$devicePort*" -or $_.DisplayName -like "*ZK*"
}

if ($firewallRule) {
    Write-Host "  ✅ Found firewall rule(s):" -ForegroundColor Green
    $firewallRule | ForEach-Object {
        Write-Host "     • $($_.DisplayName) - $($_.Enabled)" -ForegroundColor Cyan
    }
} else {
    Write-Host "  ⚠️  No specific firewall rule found for port $devicePort" -ForegroundColor Yellow
    Write-Host "     Creating firewall rule now..." -ForegroundColor Yellow

    try {
        New-NetFirewallRule -DisplayName "ZK Attendance Device" `
            -Direction Inbound -Protocol TCP -LocalPort $devicePort -Action Allow `
            -ErrorAction Stop | Out-Null
        Write-Host "     ✅ Firewall rule created successfully!" -ForegroundColor Green
    } catch {
        Write-Host "     ❌ Failed to create firewall rule (need admin rights)" -ForegroundColor Red
        Write-Host "        Run this script as Administrator to create the rule" -ForegroundColor Yellow
    }
}

# Check 6: Router IP and Gateway
Write-Host "`n[6/6] Checking router/gateway information..." -ForegroundColor Green
$gateway = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1
if ($gateway) {
    Write-Host "  Router/Gateway: $($gateway.NextHop)" -ForegroundColor Cyan
    Write-Host "  Interface: $(Get-NetAdapter -InterfaceIndex $gateway.InterfaceIndex | Select-Object -ExpandProperty Name)" -ForegroundColor Cyan
}

# Summary
Write-Host "`n=== Diagnostic Summary ===" -ForegroundColor Cyan

$issues = @()

if (-not $pingResult) {
    $issues += "❌ Cannot ping device - Check network connectivity"
}

if ($laptopSubnet -ne $deviceSubnet) {
    $issues += "❌ Different network subnet - Connect to same network as device"
}

try {
    $portTest = Test-NetConnection -ComputerName $deviceIP -Port $devicePort -WarningAction SilentlyContinue
    if (-not $portTest.TcpTestSucceeded) {
        $issues += "❌ Port $devicePort not reachable - Check AP Isolation setting on router"
    }
} catch {
    $issues += "❌ Cannot test port - Network connectivity issue"
}

if ($issues.Count -eq 0) {
    Write-Host "`n✅ All checks passed! Device should be reachable." -ForegroundColor Green
    Write-Host "   If the app still doesn't work, try:" -ForegroundColor Yellow
    Write-Host "   1. Restart the ZK Attendance app" -ForegroundColor Yellow
    Write-Host "   2. Power cycle the fingerprint device" -ForegroundColor Yellow
    Write-Host "   3. Check if another app is using the device" -ForegroundColor Yellow
} else {
    Write-Host "`n⚠️  Found $($issues.Count) issue(s):" -ForegroundColor Red
    $issues | ForEach-Object { Write-Host "   $_" -ForegroundColor Red }

    Write-Host "`n📋 Recommended actions:" -ForegroundColor Yellow
    Write-Host "   1. Check router settings for AP/Client Isolation - DISABLE it" -ForegroundColor White
    Write-Host "   2. Ensure laptop and device are on same WiFi network" -ForegroundColor White
    Write-Host "   3. See WIFI_TROUBLESHOOTING.md for detailed solutions" -ForegroundColor White
}

Write-Host "`n=== End of Diagnostics ===" -ForegroundColor Cyan
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
