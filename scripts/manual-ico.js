const fs = require('fs');
const path = require('path');

const targetDir = path.join(__dirname, '../src-tauri/icons');
const icoPath = path.join(targetDir, 'icon.ico');

// Define layers: Standard Windows sizes
const layers = [
    { size: 16, file: '16x16.png' },
    { size: 32, file: '32x32.png' },
    { size: 48, file: '48x48.png' },
    { size: 256, file: '128x128@2x.png' } // Using 256px png
];

try {
    const buffers = [];
    let totalSize = 0;

    // Read all images
    for (const layer of layers) {
        const p = path.join(targetDir, layer.file);
        if (!fs.existsSync(p)) throw new Error(`Missing ${layer.file}`);
        const buf = fs.readFileSync(p);
        buffers.push({ ...layer, data: buf });
    }

    const count = buffers.length;
    const headerSize = 6;
    const entrySize = 16;
    const dirSize = headerSize + (entrySize * count);
    
    let currentOffset = dirSize;

    // Prepare buffer
    const icoBuf = Buffer.alloc(dirSize + buffers.reduce((acc, b) => acc + b.data.length, 0));

    // Write Header
    icoBuf.writeUInt16LE(0, 0); // Reserved
    icoBuf.writeUInt16LE(1, 2); // Type 1
    icoBuf.writeUInt16LE(count, 4); // Count

    // Write Entries
    buffers.forEach((buf, idx) => {
        const entryOffset = headerSize + (idx * entrySize);
        const width = buf.size === 256 ? 0 : buf.size;
        const height = buf.size === 256 ? 0 : buf.size;
        
        icoBuf.writeUInt8(width, entryOffset);     // Width
        icoBuf.writeUInt8(height, entryOffset + 1); // Height
        icoBuf.writeUInt8(0, entryOffset + 2);     // Colors
        icoBuf.writeUInt8(0, entryOffset + 3);     // Reserved
        icoBuf.writeUInt16LE(1, entryOffset + 4);  // Planes
        icoBuf.writeUInt16LE(32, entryOffset + 6); // BitCount
        icoBuf.writeUInt32LE(buf.data.length, entryOffset + 8); // Size
        icoBuf.writeUInt32LE(currentOffset, entryOffset + 12);  // Offset

        // Write Data
        buf.data.copy(icoBuf, currentOffset);
        currentOffset += buf.data.length;
    });

    fs.writeFileSync(icoPath, icoBuf);
    console.log(`✅ Generated multi-layer icon.ico with ${count} sizes.`);

} catch (e) {
    console.error('❌ Failed to create ICO:', e);
    process.exit(1);
}
