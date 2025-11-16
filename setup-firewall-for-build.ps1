# Setup Windows Firewall Rules for ZK Attendance Build
# This script allows the built .exe to scan the network and connect to devices
# Run this as Administrator AFTER building the application

Write-Host "`n=== ZK Attendance Firewall Setup ===" -ForegroundColor Cyan
Write-Host "This will create firewall rules for the built application`n" -ForegroundColor Yellow

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "❌ This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    pause
    exit 1
}

# Find the built .exe file
$distPath = Join-Path $PSScriptRoot "dist"
$exePath = $null

# Look for the .exe in common build locations
$possiblePaths = @(
    (Join-Path $distPath "win-unpacked\ZK Attendance.exe"),
    (Join-Path $distPath "win-unpacked\zk-attendance.exe"),
    (Get-ChildItem -Path $distPath -Filter "*.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 | Select-Object -ExpandProperty FullName)
)

foreach ($path in $possiblePaths) {
    if ($path -and (Test-Path $path)) {
        $exePath = $path
        break
    }
}

if (-not $exePath) {
    Write-Host "❌ Could not find the built .exe file" -ForegroundColor Red
    Write-Host "Please build the application first using: npm run build:win" -ForegroundColor Yellow
    Write-Host "Or provide the path to the .exe manually." -ForegroundColor Yellow
    pause
    exit 1
}

Write-Host "✅ Found application: $exePath" -ForegroundColor Green

# Remove existing rules if they exist
Write-Host "`nRemoving old firewall rules..." -ForegroundColor Yellow
Remove-NetFirewallRule -DisplayName "ZK Attendance App*" -ErrorAction SilentlyContinue

# Create inbound rule for the application
Write-Host "Creating inbound firewall rule..." -ForegroundColor Green
try {
    New-NetFirewallRule -DisplayName "ZK Attendance App (Inbound)" `
        -Direction Inbound `
        -Program $exePath `
        -Action Allow `
        -Profile Domain,Private,Public `
        -ErrorAction Stop | Out-Null
    Write-Host "✅ Inbound rule created" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to create inbound rule: $($_.Exception.Message)" -ForegroundColor Red
}

# Create outbound rule for the application
Write-Host "Creating outbound firewall rule..." -ForegroundColor Green
try {
    New-NetFirewallRule -DisplayName "ZK Attendance App (Outbound)" `
        -Direction Outbound `
        -Program $exePath `
        -Action Allow `
        -Profile Domain,Private,Public `
        -ErrorAction Stop | Out-Null
    Write-Host "✅ Outbound rule created" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to create outbound rule: $($_.Exception.Message)" -ForegroundColor Red
}

# Also create rules for port 4370 (ZK device port)
Write-Host "`nCreating port 4370 firewall rules..." -ForegroundColor Green
try {
    # Remove existing port rules
    Remove-NetFirewallRule -DisplayName "ZK Device Port*" -ErrorAction SilentlyContinue

    # Inbound port 4370
    New-NetFirewallRule -DisplayName "ZK Device Port 4370 (Inbound)" `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort 4370 `
        -Action Allow `
        -Profile Domain,Private,Public `
        -ErrorAction Stop | Out-Null

    # Outbound port 4370
    New-NetFirewallRule -DisplayName "ZK Device Port 4370 (Outbound)" `
        -Direction Outbound `
        -Protocol TCP `
        -RemotePort 4370 `
        -Action Allow `
        -Profile Domain,Private,Public `
        -ErrorAction Stop | Out-Null

    Write-Host "✅ Port 4370 rules created" -ForegroundColor Green
} catch {
    Write-Host "❌ Failed to create port rules: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "`n=== Summary ===" -ForegroundColor Cyan
Write-Host "✅ Firewall rules have been configured!" -ForegroundColor Green
Write-Host "`nCreated rules:" -ForegroundColor Yellow
Write-Host "  • ZK Attendance App (Inbound)" -ForegroundColor White
Write-Host "  • ZK Attendance App (Outbound)" -ForegroundColor White
Write-Host "  • ZK Device Port 4370 (Inbound)" -ForegroundColor White
Write-Host "  • ZK Device Port 4370 (Outbound)" -ForegroundColor White

Write-Host "`n📝 NOTE: You'll need to run this script again after rebuilding the app" -ForegroundColor Yellow
Write-Host "    if the .exe path changes." -ForegroundColor Yellow

Write-Host "`nYou can now run your built application!" -ForegroundColor Green
Write-Host ""
