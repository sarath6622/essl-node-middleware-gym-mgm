const { db } = require("../config/firebaseConfig");
const log = require("../utils/logger");

const USERS_COLLECTION = "users";

// In-memory cache with TTL (Time To Live)
const userCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 1000; // Prevent unlimited memory growth

/**
 * Clean expired cache entries
 */
function cleanExpiredCache() {
  const now = Date.now();
  let deletedCount = 0;

  for (const [key, value] of userCache.entries()) {
    if (now > value.expiresAt) {
      userCache.delete(key);
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    log("debug", `Cleaned ${deletedCount} expired cache entries`);
  }
}

/**
 * Clear entire cache (useful for forced refresh)
 */
function clearUserCache() {
  const size = userCache.size;
  userCache.clear();
  log("info", `User cache cleared (${size} entries removed)`);
}

/**
 * Evict oldest cache entries if size limit exceeded
 */
function evictOldestIfNeeded() {
  if (userCache.size >= MAX_CACHE_SIZE) {
    // Delete 20% of oldest entries
    const toDelete = Math.floor(MAX_CACHE_SIZE * 0.2);
    const entries = Array.from(userCache.entries())
      .sort((a, b) => a[1].cachedAt - b[1].cachedAt)
      .slice(0, toDelete);

    entries.forEach(([key]) => userCache.delete(key));
    log("warning", `Cache size limit reached. Evicted ${toDelete} oldest entries`);
  }
}

// Run cache cleanup every 10 minutes
setInterval(cleanExpiredCache, 10 * 60 * 1000);

/**
 * Fetches user details from Firestore based on the biometric device ID.
 * Uses in-memory cache with TTL to reduce database queries.
 * @param {string} biometricDeviceId The biometric device ID from the attendance punch.
 * @param {boolean} skipCache If true, bypass cache and fetch from database
 * @returns {object|null} The user data or null if not found.
 */
async function getUserByBiometricId(biometricDeviceId, skipCache = false) {
  if (!db) {
    log("error", "Firestore is not initialized. Cannot fetch user details.");
    return null;
  }

  const cacheKey = String(biometricDeviceId);
  const now = Date.now();

  // Check cache first (unless skipCache is true)
  if (!skipCache && userCache.has(cacheKey)) {
    const cached = userCache.get(cacheKey);

    if (now < cached.expiresAt) {
      log("debug", `Cache hit for biometricDeviceId: ${biometricDeviceId}`);
      return cached.data;
    } else {
      // Expired entry
      userCache.delete(cacheKey);
      log("debug", `Cache expired for biometricDeviceId: ${biometricDeviceId}`);
    }
  }

  // Cache miss or expired - fetch from Firestore
  try {
    log("debug", `Cache miss for biometricDeviceId: ${biometricDeviceId} - querying Firestore`);

    const usersRef = db.collection(USERS_COLLECTION);
    const querySnapshot = await usersRef
      .where("biometricDeviceId", "==", cacheKey)
      .limit(1)
      .get();

    let userData = null;

    if (querySnapshot.empty) {
      log(
        "warning",
        `No user found with biometricDeviceId: ${biometricDeviceId}`
      );
    } else {
      const userDoc = querySnapshot.docs[0];
      const docData = userDoc.data();
      log("info", `Fetched user details for biometricDeviceId: ${biometricDeviceId} - User: ${docData.name}`);

      userData = {
        id: userDoc.id,
        ...docData,
      };
    }

    // Cache the result (even if null, to avoid repeated queries for non-existent users)
    evictOldestIfNeeded();
    userCache.set(cacheKey, {
      data: userData,
      cachedAt: now,
      expiresAt: now + CACHE_TTL,
    });

    return userData;
  } catch (error) {
    log("error", `Failed to fetch user details for biometricDeviceId: ${biometricDeviceId}`, {
      errorMessage: error.message,
    });
    return null;
  }
}

/**
 * Invalidate cache for a specific user
 * @param {string} biometricDeviceId The biometric device ID
 */
function invalidateUserCache(biometricDeviceId) {
  const cacheKey = String(biometricDeviceId);
  if (userCache.delete(cacheKey)) {
    log("info", `Cache invalidated for biometricDeviceId: ${biometricDeviceId}`);
  }
}

/**
 * Pre-warm cache by loading all users on startup
 * This dramatically improves first-scan performance
 */
async function prewarmCache() {
  if (!db) {
    log("warning", "Cannot prewarm cache - Firestore not initialized");
    return;
  }

  try {
    log("info", "🔥 Pre-warming user cache from Firestore...");
    const startTime = Date.now();

    const usersRef = db.collection(USERS_COLLECTION);
    const snapshot = await usersRef
      .where("biometricDeviceId", "!=", null) // Only users with biometric IDs
      .get();

    const now = Date.now();
    let cachedCount = 0;

    snapshot.forEach((doc) => {
      const userData = {
        id: doc.id,
        ...doc.data(),
      };

      const cacheKey = String(userData.biometricDeviceId);
      userCache.set(cacheKey, {
        data: userData,
        cachedAt: now,
        expiresAt: now + CACHE_TTL,
      });
      cachedCount++;
    });

    const duration = Date.now() - startTime;
    log("success", `✅ Cache pre-warmed with ${cachedCount} users in ${duration}ms`);
  } catch (error) {
    log("error", `Failed to prewarm cache: ${error.message}`);
  }
}

/**
 * Get cache statistics
 * @returns {object} Cache stats
 */
function getCacheStats() {
  const now = Date.now();
  let validEntries = 0;
  let expiredEntries = 0;

  for (const [, value] of userCache.entries()) {
    if (now < value.expiresAt) {
      validEntries++;
    } else {
      expiredEntries++;
    }
  }

  return {
    totalEntries: userCache.size,
    validEntries,
    expiredEntries,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL,
  };
}

module.exports = {
  getUserByBiometricId,
  clearUserCache,
  invalidateUserCache,
  getCacheStats,
  prewarmCache,
};
