# Build script for Windows without code signing
# This clears the electron-builder cache and builds without signing

Write-Host "`n=== Building Windows Executable ===" -ForegroundColor Cyan
Write-Host "This will create an unsigned Windows build`n" -ForegroundColor Yellow

# Clear electron-builder cache to avoid symlink issues
Write-Host "Clearing electron-builder cache..." -ForegroundColor Green
$cachePath = "$env:LOCALAPPDATA\electron-builder\Cache"
if (Test-Path $cachePath) {
    Remove-Item -Path $cachePath -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "✅ Cache cleared" -ForegroundColor Green
} else {
    Write-Host "ℹ️ No cache to clear" -ForegroundColor Cyan
}

Write-Host "`nBuilding application..." -ForegroundColor Green
Write-Host "(This may take a few minutes)`n" -ForegroundColor Yellow

# Build with signing disabled
npm run build:win

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Build successful!" -ForegroundColor Green
    Write-Host "`nBuilt files are in:" -ForegroundColor Cyan
    Write-Host "  • dist\win-unpacked\  (unpacked application)" -ForegroundColor White
    Write-Host "  • dist\              (installers)" -ForegroundColor White
} else {
    Write-Host "`n❌ Build failed" -ForegroundColor Red
    Write-Host "`nTry running this script as Administrator:" -ForegroundColor Yellow
    Write-Host "  Right-click PowerShell → Run as Administrator" -ForegroundColor White
}

Write-Host ""
