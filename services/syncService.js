/**
 * Sync Service
 * Monitors Firebase connectivity and syncs pending offline records when online
 */

const offlineStorage = require('./offlineStorage');
const { saveAttendanceRecord } = require('./firestoreService');
const { db } = require('../config/firebaseConfig');
const log = require('../utils/logger');

let syncInterval = null;
let isSyncing = false;
let isOnline = false;
let lastSyncAttempt = null;
let consecutiveFailures = 0;

// In-memory cache for pending record count to avoid frequent getStats() calls
let cachedPendingCount = 0;
let lastPendingCountUpdate = null;
const PENDING_COUNT_CACHE_TTL = 60000; // 1 minute cache

const SYNC_INTERVAL = 30000; // Check every 30 seconds
const MAX_CONSECUTIVE_FAILURES = 3;
const BATCH_SIZE = 10; // Sync 10 records at a time

/**
 * Check if Firebase is available
 */
async function checkFirebaseConnection() {
  if (!db) {
    return false;
  }

  try {
    // Try to read from a collection to verify connection
    await db.collection('_connection_test').limit(1).get();
    return true;
  } catch (error) {
    log('debug', `Firebase connection check failed: ${error.message}`);
    return false;
  }
}

/**
 * Sync a single attendance record to Firebase
 */
async function syncSingleRecord(record) {
  try {
    // Remove offline metadata before saving to Firebase
    const { offlineTimestamp, syncStatus, syncedAt, ...attendanceData } = record;

    await saveAttendanceRecord(attendanceData);
    log('success', `✅ Synced offline record: ${attendanceData.name || attendanceData.userId}`);

    return { success: true, id: offlineTimestamp };
  } catch (error) {
    log('error', `Failed to sync record: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Sync all pending records
 */
async function syncPendingRecords(io) {
  if (isSyncing) {
    log('debug', 'Sync already in progress, skipping...');
    return { synced: 0, failed: 0, pending: 0 };
  }

  isSyncing = true;
  lastSyncAttempt = new Date().toISOString();

  try {
    const pendingRecords = await offlineStorage.getPendingAttendance();

    if (pendingRecords.length === 0) {
      log('debug', 'No pending records to sync');
      isSyncing = false;
      return { synced: 0, failed: 0, pending: 0 };
    }

    log('info', `📤 Starting sync of ${pendingRecords.length} pending records...`);

    const syncResults = {
      synced: 0,
      failed: 0,
      pending: pendingRecords.length
    };

    const syncedIds = [];
    const failedRecords = [];

    // Process records in batches
    for (let i = 0; i < pendingRecords.length; i += BATCH_SIZE) {
      const batch = pendingRecords.slice(i, i + BATCH_SIZE);

      const batchResults = await Promise.all(
        batch.map(record => syncSingleRecord(record))
      );

      batchResults.forEach((result, index) => {
        if (result.success) {
          syncedIds.push(result.id);
          syncResults.synced++;
        } else {
          failedRecords.push(batch[index]);
          syncResults.failed++;
        }
      });

      // Emit progress update
      if (io) {
        io.emit('sync_progress', {
          total: pendingRecords.length,
          synced: syncResults.synced,
          failed: syncResults.failed,
          progress: Math.round(((i + batch.length) / pendingRecords.length) * 100)
        });
      }
    }

    // Mark successfully synced records
    if (syncedIds.length > 0) {
      await offlineStorage.markAsSynced(syncedIds);
      consecutiveFailures = 0;
    }

    // Update pending count
    syncResults.pending = pendingRecords.length - syncResults.synced;

    // Update cached pending count
    cachedPendingCount = syncResults.pending;
    lastPendingCountUpdate = Date.now();

    log('success', `✅ Sync completed: ${syncResults.synced} synced, ${syncResults.failed} failed, ${syncResults.pending} pending`);

    // Emit sync complete event
    if (io) {
      io.emit('sync_complete', syncResults);
    }

    isSyncing = false;
    return syncResults;

  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    consecutiveFailures++;
    isSyncing = false;

    if (io) {
      io.emit('sync_error', { error: error.message });
    }

    return { synced: 0, failed: 0, pending: 0, error: error.message };
  }
}

/**
 * Get pending count efficiently (uses cache when available)
 */
async function getPendingCount() {
  const now = Date.now();

  // Use cached value if fresh
  if (lastPendingCountUpdate && (now - lastPendingCountUpdate) < PENDING_COUNT_CACHE_TTL) {
    return cachedPendingCount;
  }

  // Cache is stale, refresh it
  const stats = await offlineStorage.getStats();
  cachedPendingCount = stats.pendingSync;
  lastPendingCountUpdate = now;

  return cachedPendingCount;
}

/**
 * Periodic sync check
 */
async function periodicSyncCheck(io) {
  try {
    // Check Firebase connection
    const connected = await checkFirebaseConnection();

    // Update online status
    const wasOnline = isOnline;
    isOnline = connected;

    // If we just came online, trigger immediate sync
    if (isOnline && !wasOnline) {
      log('success', '🌐 Firebase connection restored - starting sync...');
      if (io) {
        io.emit('connection_status', { online: true, timestamp: new Date().toISOString() });
      }
      await syncPendingRecords(io);
    } else if (!isOnline && wasOnline) {
      log('warning', '⚠️ Firebase connection lost - entering offline mode');
      if (io) {
        io.emit('connection_status', { online: false, timestamp: new Date().toISOString() });
      }
    } else if (isOnline) {
      // Already online - check for pending records using cached count
      const pendingCount = await getPendingCount();
      if (pendingCount > 0) {
        log('info', `Found ${pendingCount} pending records - syncing...`);
        await syncPendingRecords(io);
      }
    }

    // Stop trying after too many consecutive failures
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      log('error', `Too many consecutive sync failures (${consecutiveFailures}). Pausing sync for 5 minutes.`);
      stopSync();
      setTimeout(() => startSync(io), 5 * 60 * 1000); // Retry after 5 minutes
    }

  } catch (error) {
    log('error', `Periodic sync check failed: ${error.message}`);
  }
}

/**
 * Start automatic sync monitoring
 */
function startSync(io) {
  if (syncInterval) {
    log('debug', 'Sync service already running');
    return;
  }

  log('info', '🔄 Starting automatic sync service...');

  // Initial connection check
  checkFirebaseConnection().then(connected => {
    isOnline = connected;
    log('info', `Initial connection status: ${connected ? 'ONLINE' : 'OFFLINE'}`);

    if (io) {
      io.emit('connection_status', { online: connected, timestamp: new Date().toISOString() });
    }

    // If online, try immediate sync
    if (connected) {
      syncPendingRecords(io);
    }
  });

  // Set up periodic checks
  syncInterval = setInterval(() => periodicSyncCheck(io), SYNC_INTERVAL);

  log('success', '✅ Sync service started');
}

/**
 * Stop automatic sync monitoring
 */
function stopSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    log('info', 'Sync service stopped');
  }
}

/**
 * Get sync status
 */
async function getSyncStatus() {
  const stats = await offlineStorage.getStats();

  return {
    isOnline,
    isSyncing,
    lastSyncAttempt,
    consecutiveFailures,
    pendingRecords: stats.pendingSync,
    cachedUsers: stats.cachedUsers
  };
}

/**
 * Force sync now (manual trigger)
 */
async function forceSyncNow(io) {
  log('info', '🔄 Manual sync triggered...');

  // Check connection first
  const connected = await checkFirebaseConnection();

  if (!connected) {
    log('warning', '⚠️ Cannot sync - Firebase is offline');
    if (io) {
      io.emit('sync_error', { error: 'Firebase is offline' });
    }
    return { success: false, error: 'Firebase is offline' };
  }

  const results = await syncPendingRecords(io);
  return { success: true, results };
}

/**
 * Clean up old synced records
 */
async function cleanupOldRecords() {
  try {
    await offlineStorage.cleanupSyncedRecords();
    log('success', '✅ Old synced records cleaned up');
  } catch (error) {
    log('error', `Failed to cleanup old records: ${error.message}`);
  }
}

// Clean up old records daily
setInterval(cleanupOldRecords, 24 * 60 * 60 * 1000);

module.exports = {
  startSync,
  stopSync,
  getSyncStatus,
  forceSyncNow,
  syncPendingRecords,
  checkFirebaseConnection,
  cleanupOldRecords
};
