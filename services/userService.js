const { db } = require("../config/firebaseConfig");
const log = require("../utils/logger");
const offlineStorage = require("./offlineStorage");

const USERS_COLLECTION = "users";

// In-memory cache with TTL (Time To Live)
// OPTIMIZED FOR 500 USERS: Increased cache size to 2000 (4x headroom)
const userCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes (increased from 5 to reduce Firestore reads)
const MAX_CACHE_SIZE = 2000; // Increased from 1000 - all 500 users fit comfortably

// Cache statistics for monitoring
let cacheHits = 0;
let cacheMisses = 0;
let lastStatsReset = Date.now();

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

// Run cache cleanup every 5 minutes (reduced from 10 for faster memory management)
setInterval(cleanExpiredCache, 5 * 60 * 1000);

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
      cacheHits++;

      // OPTIMIZATION: Load photo from disk on demand if needed
      const cachedUser = { ...cached.data }; // Shallow copy to avoid mutating cache

      // OPTIMIZATION: Use Static URL instead of loading Base64
      // This elimiates disk read + base64 encoding latency on every scan
      if (cachedUser.photoLocalPath && !cachedUser.profileImageUrl) {
        // Construct URL: http://localhost:5001/static/[photoLocalPath]
        // photoLocalPath is like "photos/123.jpg"
        cachedUser.profileImageUrl = `http://localhost:5001/static/${cachedUser.photoLocalPath}`;
      }

      log("debug", `Cache hit for biometricDeviceId: ${biometricDeviceId}`);
      return cachedUser;
    } else {
      // Expired entry
      userCache.delete(cacheKey);
      log("debug", `Cache expired for biometricDeviceId: ${biometricDeviceId}`);
    }
  }

  // Cache miss or expired - fetch from Firestore
  try {
    cacheMisses++;
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

      // OPTIMIZATION: If fetched fresh from DB, also save photo to disk and strip from cache
      // Only offload if it's a Base64 string (Data URI)
      if (userData.profileImageUrl && userData.profileImageUrl.startsWith('data:')) {
        try {
          const photoPath = await offlineStorage.saveUserPhoto(userData.id, userData.profileImageUrl);
          if (photoPath) {
            userData.photoLocalPath = photoPath;
            // Keep profileImageUrl in the returned object for this request
          }
        } catch (e) {
          log("warning", `Failed to offload photo for ${userData.id}: ${e.message}`);
        }
      }
    }

    // Cache the result
    if (userData) {
      evictOldestIfNeeded();

      // Store lightweight version in cache (NO heavy profileImageUrl)
      const cacheVersion = { ...userData };
      if (cacheVersion.photoLocalPath) {
        delete cacheVersion.profileImageUrl;
      }

      userCache.set(cacheKey, {
        data: cacheVersion,
        cachedAt: now,
        expiresAt: now + CACHE_TTL,
      });
    }

    return userData;
  } catch (error) {
    log("error", `Failed to fetch user details for biometricDeviceId: ${biometricDeviceId}`, {
      errorMessage: error.message,
    });

    // Try to get from offline cache as fallback
    log("warning", `📦 Trying offline cache for biometricDeviceId: ${biometricDeviceId}`);
    try {
      const cachedUsers = await offlineStorage.getCachedUsers();
      let user = cachedUsers.find(u => String(u.biometricDeviceId) === cacheKey);

      if (user) {
        // Use Static URL for offline cache fallback too
        if (user.photoLocalPath && !user.profileImageUrl) {
          user = {
            ...user,
            profileImageUrl: `http://localhost:5001/static/${user.photoLocalPath}`
          };
        }

        log("success", `✅ Found user in offline cache: ${user.name}`);
        return user;
      } else {
        log("warning", `User not found in offline cache either`);
        return null;
      }
    } catch (offlineError) {
      log("error", `Failed to read offline cache: ${offlineError.message}`);
      return null;
    }
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
 * MEMORY OPTIMIZED: Saves photos to disk instead of RAM
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
    let photoOffloadedCount = 0;
    const allUsers = [];

    // Parallel processing for photo saving might be too heavy, doing sequential for safety
    for (const doc of snapshot.docs) {
      const userData = {
        id: doc.id,
        ...doc.data(),
      };

      // MEMORY OPTIMIZATION: Offload photo to disk
      // Only process if it looks like a base64 image (starts with data:)
      if (userData.profileImageUrl && userData.profileImageUrl.startsWith('data:')) {
        try {
          const photoPath = await offlineStorage.saveUserPhoto(userData.id, userData.profileImageUrl);
          if (photoPath) {
            userData.photoLocalPath = photoPath;
            delete userData.profileImageUrl; // Remove heavy data from RAM object
            photoOffloadedCount++;
          }
        } catch (e) {
          log('warning', `Failed to save photo for ${userData.id}: ${e.message}`);
        }
      }

      const cacheKey = String(userData.biometricDeviceId);
      userCache.set(cacheKey, {
        data: userData,
        cachedAt: now,
        expiresAt: now + CACHE_TTL,
      });
      allUsers.push(userData);
      cachedCount++;
    }

    // Also save to offline storage for offline access (now lightweight)
    await offlineStorage.cacheUsers(allUsers);

    const duration = Date.now() - startTime;
    log("success", `✅ Cache pre-warmed with ${cachedCount} users (${photoOffloadedCount} photos externalized) in ${duration}ms`);
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

  const totalRequests = cacheHits + cacheMisses;
  const hitRate = totalRequests > 0 ? ((cacheHits / totalRequests) * 100).toFixed(2) : 0;
  const timeSinceReset = Math.round((now - lastStatsReset) / 1000 / 60); // minutes

  return {
    totalEntries: userCache.size,
    validEntries,
    expiredEntries,
    maxSize: MAX_CACHE_SIZE,
    ttlMs: CACHE_TTL,
    ttlMinutes: CACHE_TTL / 60 / 1000,
    cacheHits,
    cacheMisses,
    totalRequests,
    hitRate: `${hitRate}%`,
    timeSinceResetMinutes: timeSinceReset,
    // Firestore read reduction estimate
    firestoreReadsSaved: cacheHits,
  };
}

/**
 * Reset cache statistics
 */
function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
  lastStatsReset = Date.now();
  log("info", "Cache statistics reset");
}

module.exports = {
  getUserByBiometricId,
  clearUserCache,
  invalidateUserCache,
  getCacheStats,
  resetCacheStats,
  prewarmCache,
};
