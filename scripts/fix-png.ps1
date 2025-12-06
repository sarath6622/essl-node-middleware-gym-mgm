$source = "app-icon.png"
$fixed = "app-icon-fixed.png"

Add-Type -AssemblyName System.Drawing

try {
    $img = [System.Drawing.Image]::FromFile($source)
    $img.Save($fixed, [System.Drawing.Imaging.ImageFormat]::Png)
    $img.Dispose()
    Write-Host "✅ Re-saved PNG successfully."
} catch {
    Write-Error "Failed to process image: $_"
    exit 1
}
