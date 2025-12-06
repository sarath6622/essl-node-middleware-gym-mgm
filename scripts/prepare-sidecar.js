const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');

async function prepareSidecar() {
  console.log('🚀 Preparing Sidecar...');

  const rootDir = path.join(__dirname, '..');
  const tauriBinDir = path.join(rootDir, 'src-tauri', 'binaries');

  // Ensure directories exist
  await fs.ensureDir(tauriBinDir);

  // 1. Build the Node.js backend
  console.log('📦 Building backend binary with pkg...');
  try {
    execSync('npm run build-backend', { stdio: 'inherit', cwd: rootDir });
  } catch (error) {
    console.error('❌ Failed to build backend.');
    process.exit(1);
  }

  // 2. Move binary to sidecar location
  const sourceBin = path.join(rootDir, 'backend-win-x64.exe');
  // Note: We use the name 'backend.exe' (no triple extension like before for simplicity, but Tauri expects 'backend-ARCH.exe' unless we config otherwise)
  // Wait, in our tauri.json we configured externalBin: ["binaries/backend"]
  // On Windows, Tauri looks for "backend-x86_64-pc-windows-msvc.exe" appended.
  // Wait, if I just rename it to 'backend.exe' inside 'binaries', Tauri might not find it if it expects the target triple suffix.
  // BUT, I manually renamed it to 'backend-x86_64-pc-windows-msvc.exe' in previous steps OR 'backend.exe' and failed?
  // Let's check my previous walkthrough.
  // "Renamed the sidecar identifier from backend-win-x64 to backend"
  // And "Updated externalBin to ['binaries/backend']".
  // Tauri documentation: "The external binary must be named with the target triple suffix".
  // So if I name the command "backend", the file MUST be "backend-x86_64-pc-windows-msvc.exe".
  
  const targetTriple = 'x86_64-pc-windows-msvc';
  const targetBin = path.join(tauriBinDir, `backend-${targetTriple}.exe`);

  console.log(`🚚 Moving binary to ${targetBin}...`);
  await fs.move(sourceBin, targetBin, { overwrite: true });

  // 3. Copy native modules
  console.log('🔗 Copying native modules...');
  const betterSqliteSource = path.join(rootDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  const betterSqliteTarget = path.join(tauriBinDir, 'better_sqlite3.node');

  if (await fs.pathExists(betterSqliteSource)) {
    await fs.copy(betterSqliteSource, betterSqliteTarget, { overwrite: true });
    console.log('✅ Native module copied.');
  } else {
    console.error('❌ Could not find better_sqlite3.node. Did you run npm install?');
    process.exit(1);
  }

  console.log('✨ Sidecar prepared successfully!');
}

prepareSidecar();
