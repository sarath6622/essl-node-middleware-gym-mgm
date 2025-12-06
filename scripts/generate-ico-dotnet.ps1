$source = "app-icon.png"
$target = "src-tauri/icons/icon.ico"

Add-Type -AssemblyName System.Drawing

try {
    Write-Host "Reading $source..."
    $img = [System.Drawing.Bitmap]::FromFile($source)
    
    # Create a 256x256 bitmap (standard large icon)
    $size = 256
    $resized = new-object System.Drawing.Bitmap $size, $size
    $graph = [System.Drawing.Graphics]::FromImage($resized)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.DrawImage($img, 0, 0, $size, $size)
    $graph.Dispose()

    # Create Icon from Bitmap
    # GetHicon creates a cursor handle, so we need to be careful, but it generally works for ICO save
    $hIcon = $resized.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    
    $stream = new-object System.IO.FileStream($target, [System.IO.FileMode]::Create)
    $icon.Save($stream)
    $stream.Close()
    
    # Cleanup
    # [System.Runtime.InteropServices.Marshal]::DestroyIcon($hIcon) | Out-Null
    $icon.Dispose()
    $resized.Dispose()
    $img.Dispose()

    Write-Host "✅ Generated $target using System.Drawing.Icon"
} catch {
    Write-Error "Failed to generate ICO: $_"
    exit 1
}
