/**
 * Retry helper with exponential backoff
 * Provides utilities for retrying operations with configurable strategies
 */

const log = require("./logger");

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay
 * @param {number} attempt - Current attempt number (0-based)
 * @param {number} baseDelay - Base delay in ms
 * @param {number} maxDelay - Maximum delay in ms
 * @param {boolean} jitter - Add random jitter to avoid thundering herd
 */
function calculateBackoff(attempt, baseDelay = 1000, maxDelay = 30000, jitter = true) {
  // Exponential: delay = baseDelay * 2^attempt
  let delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

  // Add jitter (random ±25%)
  if (jitter) {
    const jitterAmount = delay * 0.25;
    delay = delay + (Math.random() * 2 - 1) * jitterAmount;
  }

  return Math.floor(delay);
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {object} options - Retry options
 * @param {number} options.maxAttempts - Maximum number of attempts (default: 5)
 * @param {number} options.baseDelay - Base delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 30000)
 * @param {boolean} options.jitter - Add jitter to delays (default: true)
 * @param {Function} options.onRetry - Callback on retry (attempt, error, delay)
 * @param {Function} options.shouldRetry - Function to determine if should retry (error) => boolean
 * @param {string} options.operationName - Name for logging
 * @returns {Promise} Result of successful operation
 */
async function retryWithBackoff(operation, options = {}) {
  const {
    maxAttempts = 5,
    baseDelay = 1000,
    maxDelay = 30000,
    jitter = true,
    onRetry = null,
    shouldRetry = null,
    operationName = "Operation",
  } = options;

  let lastError;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      // Attempt the operation
      const result = await operation();

      // Success
      if (attempt > 0) {
        log("success", `${operationName} succeeded on attempt ${attempt + 1}/${maxAttempts}`);
      }

      return result;
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (shouldRetry && !shouldRetry(error)) {
        log("error", `${operationName} failed with non-retryable error:`, error.message);
        throw error;
      }

      // Check if we have more attempts
      if (attempt >= maxAttempts - 1) {
        log("error", `${operationName} failed after ${maxAttempts} attempts`);
        break;
      }

      // Calculate backoff delay
      const delay = calculateBackoff(attempt, baseDelay, maxDelay, jitter);

      log(
        "warning",
        `${operationName} failed (attempt ${attempt + 1}/${maxAttempts}). Retrying in ${Math.round(delay / 1000)}s...`,
        { error: error.message }
      );

      // Call retry callback if provided
      if (onRetry) {
        try {
          await onRetry(attempt, error, delay);
        } catch (callbackError) {
          log("warning", "Retry callback error:", callbackError.message);
        }
      }

      // Wait before retrying
      await sleep(delay);
    }
  }

  // All attempts failed
  throw lastError;
}

/**
 * Retry with linear backoff (constant delay between attempts)
 * @param {Function} operation - Async function to retry
 * @param {object} options - Retry options
 * @returns {Promise} Result of successful operation
 */
async function retryWithLinearBackoff(operation, options = {}) {
  return retryWithBackoff(operation, {
    ...options,
    baseDelay: options.delay || 2000,
    maxDelay: options.delay || 2000, // Same as base = linear
  });
}

/**
 * Circuit breaker pattern
 * Stops trying after too many failures
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.state = "CLOSED"; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
    this.lastFailureTime = null;
    this.operationName = options.operationName || "Operation";
  }

  async execute(operation) {
    // Check if circuit should reset
    if (
      this.state === "OPEN" &&
      Date.now() - this.lastFailureTime > this.resetTimeout
    ) {
      log("info", `${this.operationName} circuit breaker: Attempting to close (half-open)`);
      this.state = "HALF_OPEN";
    }

    // Circuit is open - fail fast
    if (this.state === "OPEN") {
      const timeUntilReset = Math.ceil(
        (this.resetTimeout - (Date.now() - this.lastFailureTime)) / 1000
      );
      throw new Error(
        `Circuit breaker is OPEN. Retry in ${timeUntilReset}s. (${this.failures} consecutive failures)`
      );
    }

    try {
      const result = await operation();

      // Success - reset circuit
      if (this.state === "HALF_OPEN" || this.failures > 0) {
        log("success", `${this.operationName} circuit breaker: Closing (operation succeeded)`);
      }
      this.state = "CLOSED";
      this.failures = 0;

      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // Open circuit if threshold exceeded
      if (this.failures >= this.failureThreshold) {
        this.state = "OPEN";
        log(
          "error",
          `${this.operationName} circuit breaker: Opening (${this.failures} failures, threshold: ${this.failureThreshold})`
        );
      }

      throw error;
    }
  }

  getState() {
    return {
      state: this.state,
      failures: this.failures,
      lastFailureTime: this.lastFailureTime,
      failureThreshold: this.failureThreshold,
    };
  }

  reset() {
    this.state = "CLOSED";
    this.failures = 0;
    this.lastFailureTime = null;
    log("info", `${this.operationName} circuit breaker: Manually reset`);
  }
}

module.exports = {
  retryWithBackoff,
  retryWithLinearBackoff,
  calculateBackoff,
  CircuitBreaker,
  sleep,
};
