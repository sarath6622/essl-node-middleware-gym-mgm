#!/usr/bin/env node
/**
 * Simple script to create a placeholder PNG icon from SVG
 * This is a fallback - for production, use a proper icon
 */

const fs = require('fs');
const path = require('path');

// Create a simple base64 encoded 1x1 transparent PNG as placeholder
const transparentPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const iconPath = path.join(__dirname, 'icon.png');

// Only create if doesn't exist
if (!fs.existsSync(iconPath)) {
  fs.writeFileSync(iconPath, transparentPNG);
  console.log('✓ Created placeholder icon.png');
  console.log('  Replace this with your actual app icon (512x512 PNG recommended)');
} else {
  console.log('✓ icon.png already exists');
}
