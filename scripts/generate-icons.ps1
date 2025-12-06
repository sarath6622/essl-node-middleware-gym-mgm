$source = "app-icon.png"
$targetDir = "src-tauri/icons"
$iconSizes = @(
    @{Name="32x32.png"; Size=32},
    @{Name="16x16.png"; Size=16},
    @{Name="48x48.png"; Size=48},
    @{Name="128x128.png"; Size=128},
    @{Name="128x128@2x.png"; Size=256},
    @{Name="icon.png"; Size=512},
    @{Name="StoreLogo.png"; Size=50},
    @{Name="Square30x30Logo.png"; Size=30},
    @{Name="Square44x44Logo.png"; Size=44},
    @{Name="Square71x71Logo.png"; Size=71},
    @{Name="Square89x89Logo.png"; Size=89},
    @{Name="Square107x107Logo.png"; Size=107},
    @{Name="Square142x142Logo.png"; Size=142},
    @{Name="Square150x150Logo.png"; Size=150},
    @{Name="Square284x284Logo.png"; Size=284},
    @{Name="Square310x310Logo.png"; Size=310}
)

Add-Type -AssemblyName System.Drawing

$srcImage = [System.Drawing.Image]::FromFile($source)

foreach ($item in $iconSizes) {
    $targetPath = Join-Path $targetDir $item.Name
    Write-Host "Generating $targetPath..."
    
    $newBmp = New-Object System.Drawing.Bitmap($item.Size, $item.Size)
    $graph = [System.Drawing.Graphics]::FromImage($newBmp)
    $graph.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graph.DrawImage($srcImage, 0, 0, $item.Size, $item.Size)
    
    $newBmp.Save($targetPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $graph.Dispose()
    $newBmp.Dispose()
}

$srcImage.Dispose()

Write-Host "PNG Icons updated."
