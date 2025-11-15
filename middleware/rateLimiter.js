/**
 * Simple in-memory rate limiter middleware
 * Tracks request counts per IP address and enforces limits
 */

const log = require("../utils/logger");

// Store request counts per IP
const requestCounts = new Map();

// Rate limit configurations
const RATE_LIMITS = {
  default: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
  },
  strict: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10, // 10 requests per minute (for expensive operations)
  },
  loose: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 120, // 120 requests per minute
  },
};

/**
 * Clean up expired entries periodically
 */
function cleanupExpiredEntries() {
  const now = Date.now();
  let cleaned = 0;

  for (const [key, data] of requestCounts.entries()) {
    if (now > data.resetTime) {
      requestCounts.delete(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    log("debug", `Rate limiter: Cleaned ${cleaned} expired entries`);
  }
}

// Run cleanup every 5 minutes
setInterval(cleanupExpiredEntries, 5 * 60 * 1000);

/**
 * Get client identifier (IP address)
 */
function getClientId(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    req.ip ||
    "unknown"
  );
}

/**
 * Create rate limiter middleware
 * @param {string} limitType - Type of limit: 'default', 'strict', or 'loose'
 * @param {object} customConfig - Optional custom configuration
 */
function createRateLimiter(limitType = "default", customConfig = {}) {
  const config = { ...RATE_LIMITS[limitType], ...customConfig };
  const { windowMs, maxRequests } = config;

  return function rateLimiterMiddleware(req, res, next) {
    const clientId = getClientId(req);
    const now = Date.now();

    // Get or create client record
    let clientData = requestCounts.get(clientId);

    if (!clientData || now > clientData.resetTime) {
      // First request or window expired - reset
      clientData = {
        count: 0,
        resetTime: now + windowMs,
      };
      requestCounts.set(clientId, clientData);
    }

    // Increment request count
    clientData.count++;

    // Check if limit exceeded
    if (clientData.count > maxRequests) {
      const retryAfter = Math.ceil((clientData.resetTime - now) / 1000);

      log(
        "warning",
        `Rate limit exceeded for ${clientId} on ${req.method} ${req.path} (${clientData.count}/${maxRequests})`
      );

      return res.status(429).json({
        error: "Too Many Requests",
        message: `Rate limit exceeded. Maximum ${maxRequests} requests per ${Math.ceil(
          windowMs / 1000
        )} seconds.`,
        retryAfter,
      });
    }

    // Add rate limit headers
    res.setHeader("X-RateLimit-Limit", maxRequests);
    res.setHeader("X-RateLimit-Remaining", Math.max(0, maxRequests - clientData.count));
    res.setHeader("X-RateLimit-Reset", Math.ceil(clientData.resetTime / 1000));

    next();
  };
}

/**
 * Get rate limiter statistics
 */
function getRateLimiterStats() {
  const now = Date.now();
  const activeClients = [];

  for (const [clientId, data] of requestCounts.entries()) {
    if (now < data.resetTime) {
      activeClients.push({
        clientId,
        requestCount: data.count,
        resetIn: Math.ceil((data.resetTime - now) / 1000),
      });
    }
  }

  return {
    totalTracked: requestCounts.size,
    activeClients: activeClients.length,
    clients: activeClients.sort((a, b) => b.requestCount - a.requestCount).slice(0, 10), // Top 10
  };
}

/**
 * Clear all rate limit data (for testing or reset)
 */
function clearRateLimits() {
  const size = requestCounts.size;
  requestCounts.clear();
  log("info", `Rate limiter: Cleared ${size} entries`);
}

module.exports = {
  createRateLimiter,
  getRateLimiterStats,
  clearRateLimits,
  RATE_LIMITS,
};
