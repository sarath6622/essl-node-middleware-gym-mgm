# App Icon Placeholder

This file indicates where the app icon should be placed.

## Required Icon Files

Place your app icon as `icon.png` in this directory (`electron/icon.png`).

### Recommended Icon Specifications:

- **Format**: PNG with transparency
- **Size**: 512x512 pixels minimum
- **Design**: Simple, recognizable fingerprint or attendance-related icon

### For Production Builds:

You'll want to provide icons for different platforms:

**macOS:**
- `icon.icns` - macOS icon file
- Or use `electron-icon-builder` to generate from PNG

**Windows:**
- `icon.ico` - Windows icon file
- Or use `electron-icon-builder` to generate from PNG

**Linux:**
- PNG files in various sizes (16, 32, 48, 64, 128, 256, 512, 1024)

### Quick Icon Generation:

You can use online tools or npm packages:

```bash
# Install electron-icon-builder
npm install --save-dev electron-icon-builder

# Generate icons from a single PNG
npx electron-icon-builder --input=./icon-source.png --output=./electron/
```

### Temporary Solution:

For now, create a simple 512x512 PNG icon and save it as `electron/icon.png`.
You can use any graphic design tool or online icon generator.

The app will still work without a custom icon, but it will use Electron's default icon.
