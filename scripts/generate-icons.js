const fs = require('fs');
const pngToIco = require('png-to-ico').default;
const path = require('path');

const source = 'app-icon.png';
const targetDir = 'src-tauri/icons';

async function generate() {
  console.log('Using png-to-ico to generate icon.ico from ' + source);
  
  try {
    // Generate ICO
    const buf = await pngToIco(source);
    fs.writeFileSync(path.join(targetDir, 'icon.ico'), buf);
    console.log('✅ Generated icon.ico');
  } catch (error) {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  }
}

generate();
