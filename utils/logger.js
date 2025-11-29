// Enhanced Logger with File-Based Logging and Hourly Rotation
const fs = require('fs');
const path = require('path');

let silentMode = false;
let electronWindow = null;
let currentLogFile = null;
let currentLogHour = null;
let logStream = null;

// Base directory for logs
const LOG_BASE_DIR = path.join(process.cwd(), 'logs');

function setElectronWindow(window) {
  electronWindow = window;
  silentMode = true; // Enable silent mode when Electron window is set
}

/**
 * Get time of day period based on hour
 * @param {number} hour - Hour in 24-hour format (0-23)
 * @returns {string} - Time period (morning/afternoon/evening/night)
 */
function getTimeOfDay(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  if (hour >= 18 && hour < 22) return 'evening';
  return 'night'; // 22-5
}

/**
 * Get the log file path for current date/time
 * Format: logs/YYYY-MM/DD/time-of-day/HH.txt
 * @returns {string} - Full path to log file
 */
function getLogFilePath() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = now.getHours();
  const hourStr = String(hour).padStart(2, '0');
  const timeOfDay = getTimeOfDay(hour);

  const yearMonth = `${year}-${month}`;
  const logDir = path.join(LOG_BASE_DIR, yearMonth, day, timeOfDay);
  const logFile = path.join(logDir, `${hourStr}.txt`);

  return { logFile, logDir, hour };
}

/**
 * Ensure log directory exists
 * @param {string} dirPath - Directory path to create
 */
function ensureLogDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Rotate log file if hour has changed
 */
function rotateLogFileIfNeeded() {
  const { logFile, logDir, hour } = getLogFilePath();

  // Check if we need to rotate (hour changed or first log)
  if (currentLogHour !== hour || currentLogFile !== logFile) {
    // Close existing stream
    if (logStream) {
      logStream.end();
      logStream = null;
    }

    // Create new directory if needed
    ensureLogDirectory(logDir);

    // Open new log file (append mode)
    currentLogFile = logFile;
    currentLogHour = hour;
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Log rotation event to console (not to file to avoid recursion)
    if (!silentMode) {
      console.log(`[${new Date().toISOString()}] 📁 Log file rotated: ${logFile}`);
    }
  }
}

/**
 * Write log entry to file
 * @param {string} timestamp - ISO timestamp
 * @param {string} level - Log level
 * @param {string} prefix - Emoji prefix
 * @param {string} message - Log message
 * @param {object|null} data - Additional data
 */
function writeToFile(timestamp, level, prefix, message, data) {
  try {
    // Ensure we're writing to the correct file for current hour
    rotateLogFileIfNeeded();

    if (logStream) {
      // Format: [timestamp] LEVEL prefix message
      let logLine = `[${timestamp}] ${level.toUpperCase().padEnd(7)} ${prefix} ${message}\n`;

      // Add data if present
      if (data) {
        logLine += `  Data: ${JSON.stringify(data)}\n`;
      }

      // Write asynchronously (non-blocking)
      logStream.write(logLine);
    }
  } catch (error) {
    // Fail silently to prevent logging errors from crashing the app
    console.error('Failed to write to log file:', error.message);
  }
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

  // Write to file (async, non-blocking)
  writeToFile(timestamp, level, prefix, message, data);

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

/**
 * Gracefully close log stream on app shutdown
 */
function closeLogStream() {
  if (logStream) {
    logStream.end();
    logStream = null;
  }
}

// Handle process termination
process.on('exit', closeLogStream);
process.on('SIGINT', () => {
  closeLogStream();
  process.exit(0);
});
process.on('SIGTERM', () => {
  closeLogStream();
  process.exit(0);
});

module.exports = log;
module.exports.setElectronWindow = setElectronWindow;
module.exports.closeLogStream = closeLogStream;
