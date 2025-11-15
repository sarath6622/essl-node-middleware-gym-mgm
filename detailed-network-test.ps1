# Detailed Network Connectivity Test
Write-Host "`n=== ZK Device Network Analysis ===" -ForegroundColor Cyan

$deviceIP = "192.168.1.74"
$devicePort = 4370

# Test 1: Check your current IP and adapter
Write-Host "`n[1/5] Your network adapters:" -ForegroundColor Green
$adapters = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
    $_.IPAddress -notlike "169.254.*" -and $_.IPAddress -ne "127.0.0.1"
}

foreach ($adapter in $adapters) {
    $adapterInfo = Get-NetAdapter -InterfaceIndex $adapter.InterfaceIndex
    $status = if ($adapterInfo.Status -eq 'Up') { "✅" } else { "❌" }
    Write-Host "  $status $($adapter.IPAddress) - $($adapterInfo.InterfaceDescription) ($($adapterInfo.MediaType))" -ForegroundColor Cyan
}

# Test 2: Which adapter is being used to reach the device?
Write-Host "`n[2/5] Finding route to device..." -ForegroundColor Green
$route = Find-NetRoute -RemoteIPAddress $deviceIP | Select-Object -First 1
if ($route) {
    $routeAdapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex
    Write-Host "  Traffic to $deviceIP goes through:" -ForegroundColor White
    Write-Host "  • Interface: $($routeAdapter.InterfaceDescription)" -ForegroundColor Cyan
    Write-Host "  • Media Type: $($routeAdapter.MediaType)" -ForegroundColor Cyan
    Write-Host "  • Status: $($routeAdapter.Status)" -ForegroundColor Cyan

    $localIP = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1
    Write-Host "  • Your IP: $($localIP.IPAddress)" -ForegroundColor Cyan
} else {
    Write-Host "  ❌ No route found to device" -ForegroundColor Red
}

# Test 3: Basic ping
Write-Host "`n[3/5] Testing ping (ICMP)..." -ForegroundColor Green
$pingResult = Test-Connection -ComputerName $deviceIP -Count 2 -ErrorAction SilentlyContinue
if ($pingResult) {
    $avgTime = ($pingResult | Measure-Object -Property ResponseTime -Average).Average
    Write-Host "  ✅ Ping successful (avg ${avgTime}ms)" -ForegroundColor Green
} else {
    Write-Host "  ❌ Ping failed" -ForegroundColor Red
}

# Test 4: Port connectivity
Write-Host "`n[4/5] Testing port $devicePort (TCP)..." -ForegroundColor Green
$portTest = Test-NetConnection -ComputerName $deviceIP -Port $devicePort -WarningAction SilentlyContinue
if ($portTest.TcpTestSucceeded) {
    Write-Host "  ✅ Port $devicePort is OPEN and reachable" -ForegroundColor Green
    Write-Host "  • Source: $($portTest.SourceAddress.IPAddress)" -ForegroundColor Cyan
    Write-Host "  • Destination: $($portTest.RemoteAddress.IPAddress):$($portTest.RemotePort)" -ForegroundColor Cyan
} else {
    Write-Host "  ❌ Port $devicePort is NOT reachable" -ForegroundColor Red
}

# Test 5: Advanced TCP connection test
Write-Host "`n[5/5] Testing persistent TCP connection..." -ForegroundColor Green
try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $connectTask = $tcpClient.ConnectAsync($deviceIP, $devicePort)

    if ($connectTask.Wait(5000)) {
        if ($tcpClient.Connected) {
            Write-Host "  ✅ TCP connection established successfully!" -ForegroundColor Green
            Write-Host "  • Local endpoint: $($tcpClient.Client.LocalEndPoint)" -ForegroundColor Cyan
            Write-Host "  • Remote endpoint: $($tcpClient.Client.RemoteEndPoint)" -ForegroundColor Cyan

            # Try to keep connection open for a moment
            Start-Sleep -Seconds 2

            if ($tcpClient.Connected) {
                Write-Host "  ✅ Connection remains stable" -ForegroundColor Green
            } else {
                Write-Host "  ⚠️  Connection dropped after 2 seconds" -ForegroundColor Yellow
            }

            $tcpClient.Close()
        } else {
            Write-Host "  ❌ Connection failed" -ForegroundColor Red
        }
    } else {
        Write-Host "  ❌ Connection timeout (5 seconds)" -ForegroundColor Red
        $tcpClient.Close()
    }
} catch {
    Write-Host "  ❌ Error: $($_.Exception.Message)" -ForegroundColor Red
}

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan

if ($portTest.TcpTestSucceeded) {
    Write-Host "✅ Basic connectivity is GOOD" -ForegroundColor Green
    Write-Host ""
    Write-Host "The issue is likely:" -ForegroundColor Yellow
    Write-Host "  1. ZKTeco protocol-specific connection handling" -ForegroundColor White
    Write-Host "  2. Device firmware or internal firewall" -ForegroundColor White
    Write-Host "  3. Network timeout/keepalive settings" -ForegroundColor White
    Write-Host ""
    Write-Host "Try these solutions:" -ForegroundColor Yellow
    Write-Host "  • Increase timeout in deviceConfig.js (currently 10000ms)" -ForegroundColor White
    Write-Host "  • Power cycle the fingerprint device" -ForegroundColor White
    Write-Host "  • Check if another app is connected to the device" -ForegroundColor White
} else {
    Write-Host "❌ Network connectivity issue detected" -ForegroundColor Red
    Write-Host ""
    Write-Host "Possible causes:" -ForegroundColor Yellow
    Write-Host "  • Firewall blocking persistent connections" -ForegroundColor White
    Write-Host "  • Router QoS or traffic shaping rules" -ForegroundColor White
    Write-Host "  • WiFi power saving mode dropping connections" -ForegroundColor White
}

Write-Host ""
