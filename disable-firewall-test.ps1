# Temporarily disable Windows Firewall to test if that's blocking WiFi connections
# Run this as Administrator

Write-Host "`n=== Windows Firewall Test ===" -ForegroundColor Cyan
Write-Host "This will temporarily disable the firewall to test connectivity`n" -ForegroundColor Yellow

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Save current firewall state
Write-Host "Saving current firewall state..." -ForegroundColor Green
$firewallState = Get-NetFirewallProfile | Select-Object Name, Enabled

# Disable firewall
Write-Host "Disabling Windows Firewall..." -ForegroundColor Yellow
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled False

Write-Host "✅ Firewall disabled`n" -ForegroundColor Green

# Test connectivity
Write-Host "Testing connectivity to device..." -ForegroundColor Green
$portTest = Test-NetConnection -ComputerName 192.168.1.74 -Port 4370 -WarningAction SilentlyContinue

if ($portTest.TcpTestSucceeded) {
    Write-Host "✅ PORT 4370 IS NOW REACHABLE!" -ForegroundColor Green
    Write-Host ""
    Write-Host "The Windows Firewall was blocking the connection." -ForegroundColor Yellow
    Write-Host "I will now re-enable the firewall and create a specific rule for port 4370." -ForegroundColor Yellow
} else {
    Write-Host "❌ Port 4370 still NOT reachable" -ForegroundColor Red
    Write-Host ""
    Write-Host "Windows Firewall is NOT the issue." -ForegroundColor Yellow
    Write-Host "The problem is with your router's AP Isolation or WiFi settings." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Press any key to re-enable the firewall..."
$null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')

# Restore firewall
Write-Host "`nRe-enabling Windows Firewall..." -ForegroundColor Green
Set-NetFirewallProfile -Profile Domain,Public,Private -Enabled True

Write-Host "✅ Firewall restored to original state" -ForegroundColor Green

if ($portTest.TcpTestSucceeded) {
    Write-Host "`nCreating firewall rule for port 4370..." -ForegroundColor Green
    try {
        # Remove existing rule if present
        Remove-NetFirewallRule -DisplayName "ZK Attendance Device*" -ErrorAction SilentlyContinue

        # Create inbound rule
        New-NetFirewallRule -DisplayName "ZK Attendance Device (Inbound)" `
            -Direction Inbound -Protocol TCP -LocalPort 4370 -Action Allow `
            -Profile Domain,Private,Public -ErrorAction Stop | Out-Null

        # Create outbound rule
        New-NetFirewallRule -DisplayName "ZK Attendance Device (Outbound)" `
            -Direction Outbound -Protocol TCP -RemotePort 4370 -Action Allow `
            -Profile Domain,Private,Public -ErrorAction Stop | Out-Null

        Write-Host "✅ Firewall rules created!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Now try running the app: npm run electron" -ForegroundColor Cyan
    } catch {
        Write-Host "❌ Failed to create firewall rules: $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
