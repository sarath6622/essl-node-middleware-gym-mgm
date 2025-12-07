/**
 * Performance monitoring utility
 * Tracks key metrics for the attendance system
 */

const log = require("./logger");

// Performance metrics
const metrics = {
  attendanceQueueSize: 0,
  attendanceProcessed: 0,
  avgProcessingTimeMs: 0,
  lastProcessingTimeMs: 0,
  eventLoopLagMs: 0,
  peakQueueSize: 0,
  totalProcessingTimeMs: 0,
};

// Event loop lag monitoring
let lastLoopTime = Date.now();

function measureEventLoopLag() {
  const now = Date.now();
  const elapsed = now - lastLoopTime;

  // If elapsed time is significantly larger than interval (e.g. > 5 seconds)
  // It surely means system sleep/suspension, not just event loop lag
  if (elapsed > 5000) {
    log("info", `ℹ️ System suspended for ${(elapsed / 1000).toFixed(1)}s - skipping lag check`);
    lastLoopTime = now;
    return 0; // Don't report this as lag
  }

  const lag = elapsed - 100; // Expected 100ms interval
  lastLoopTime = now;

  if (lag > 0) {
    metrics.eventLoopLagMs = Math.max(0, lag);
  }

  return metrics.eventLoopLagMs;
}

// Measure event loop lag every 100ms
setInterval(measureEventLoopLag, 100);

/**
 * Update queue size metric
 */
function updateQueueSize(size) {
  metrics.attendanceQueueSize = size;
  metrics.peakQueueSize = Math.max(metrics.peakQueueSize, size);
}

/**
 * Record processing time for an attendance event
 */
function recordProcessingTime(timeMs) {
  metrics.attendanceProcessed++;
  metrics.lastProcessingTimeMs = timeMs;
  metrics.totalProcessingTimeMs += timeMs;
  metrics.avgProcessingTimeMs = Math.round(
    metrics.totalProcessingTimeMs / metrics.attendanceProcessed
  );
}

/**
 * Get current metrics
 */
function getMetrics() {
  return {
    ...metrics,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Reset metrics (for testing)
 */
function resetMetrics() {
  metrics.attendanceProcessed = 0;
  metrics.avgProcessingTimeMs = 0;
  metrics.totalProcessingTimeMs = 0;
  metrics.peakQueueSize = 0;
  log("info", "Performance metrics reset");
}

/**
 * Log performance warning if thresholds exceeded
 */
function checkThresholds() {
  const warnings = [];

  if (metrics.eventLoopLagMs > 100) {
    warnings.push(`Event loop lag: ${metrics.eventLoopLagMs}ms (threshold: 100ms)`);
  }

  if (metrics.attendanceQueueSize > 20) {
    warnings.push(`Queue backed up: ${metrics.attendanceQueueSize} items (threshold: 20)`);
  }

  if (metrics.avgProcessingTimeMs > 1000) {
    warnings.push(`Slow processing: ${metrics.avgProcessingTimeMs}ms avg (threshold: 1000ms)`);
  }

  if (warnings.length > 0) {
    log("warning", "⚠️ Performance thresholds exceeded:");
    warnings.forEach(w => log("warning", `  - ${w}`));
  }
}

// Check thresholds every 30 seconds
setInterval(checkThresholds, 30000);

module.exports = {
  updateQueueSize,
  recordProcessingTime,
  getMetrics,
  resetMetrics,
  measureEventLoopLag,
};
