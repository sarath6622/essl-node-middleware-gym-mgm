# Quick WiFi Fix Verification Script
Write-Host "`n=== Testing WiFi Connectivity to ZK Device ===" -ForegroundColor Cyan

$deviceIP = "192.168.1.74"
$devicePort = 4370

# Test 1: Ping
Write-Host "`n[1/2] Testing ping..." -ForegroundColor Green
$pingResult = Test-Connection -ComputerName $deviceIP -Count 2 -Quiet
if ($pingResult) {
    Write-Host "  ✅ Ping successful" -ForegroundColor Green
} else {
    Write-Host "  ❌ Ping failed" -ForegroundColor Red
}

# Test 2: Port connectivity
Write-Host "`n[2/2] Testing port $devicePort..." -ForegroundColor Green
$portTest = Test-NetConnection -ComputerName $deviceIP -Port $devicePort -WarningAction SilentlyContinue
if ($portTest.TcpTestSucceeded) {
    Write-Host "  ✅ Port $devicePort is reachable!" -ForegroundColor Green
} else {
    Write-Host "  ❌ Port $devicePort is NOT reachable" -ForegroundColor Red
}

# Summary
Write-Host "`n=== Summary ===" -ForegroundColor Cyan
if ($pingResult -and $portTest.TcpTestSucceeded) {
    Write-Host "✅ Network connectivity is good!" -ForegroundColor Green
    Write-Host "   You can now run the app: npm run electron" -ForegroundColor White
} else {
    Write-Host "❌ Still having connectivity issues" -ForegroundColor Red
    Write-Host "   AP Isolation might still be enabled" -ForegroundColor Yellow
    Write-Host "   Or device is on a different network segment" -ForegroundColor Yellow
}

Write-Host ""
