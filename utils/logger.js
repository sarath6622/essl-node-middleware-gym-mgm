// Logger with Electron UI support
let silentMode = false;
let electronWindow = null;

function setElectronWindow(window) {
  electronWindow = window;
  silentMode = true; // Enable silent mode when Electron window is set
}

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix =
    {
      info: "ℹ️ ",
      success: "✅",
      error: "❌",
      warning: "⚠️ ",
      debug: "🔍",
      event: "🎯",
    }[level] || "📝";

  // Send to Electron UI if available
  if (electronWindow && !electronWindow.isDestroyed()) {
    electronWindow.webContents.send('log-message', {
      level,
      message,
      prefix,
      timestamp,
      data
    });
  }

  // Only log to console if not in silent mode
  if (!silentMode) {
    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

module.exports = log;
module.exports.setElectronWindow = setElectronWindow;
