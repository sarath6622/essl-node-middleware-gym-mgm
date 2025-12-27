/**
 * Sync Service
 * Monitors Firebase connectivity and syncs pending offline records when online
 */

const offlineStorage = require('./offlineStorage');
const { saveAttendanceRecord } = require('./firestoreService');
const { db } = require('../config/firebaseConfig');
const log = require('../utils/logger');
const path = require('path');

let syncInterval = null;
let isSyncing = false;
let isOnline = false;
let lastSyncAttempt = null;
let consecutiveFailures = 0;

// In-memory cache for pending record count to avoid frequent getStats() calls
let cachedPendingCount = 0;
let lastPendingCountUpdate = null;
const PENDING_COUNT_CACHE_TTL = 60000; // 1 minute cache

const DEVICE_CONFIG = require('../config/deviceConfig');
const SYNC_INTERVAL = DEVICE_CONFIG.syncInterval || 1800000; // Default to 30 mins if missing
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
    // dbId is internal SQLite ID, offlineTimestamp is the legacy field
    const { dbId, offlineTimestamp, syncStatus, syncedAt, ...attendanceData } = record;

    await saveAttendanceRecord(attendanceData);
    log('success', `✅ Synced offline record: ${attendanceData.name || attendanceData.userId}`);

    // Return the ID so we can mark it as synced
    return { success: true, id: record.recordId || record.dbId || record.offlineTimestamp };
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

  const syncResults = { synced: 0, failed: 0, pending: 0 };

  try {
    // 1. Rotate the current pending file to isolate it as a batch
    await offlineStorage.rotatePendingFile();

    // 2. Get all batch files (including the one we just rotated)
    const batches = await offlineStorage.getBatches();

    if (batches.length === 0) {
      log('debug', 'No pending records to sync');
      isSyncing = false;
      return syncResults;
    }

    log('info', `📤 Starting sync of ${batches.length} batch files...`);

    // 3. Process each batch file
    for (const batchPath of batches) {
      const batchFailures = [];
      let batchSynced = 0;

      const rl = offlineStorage.createBatchStream(batchPath);
      if (!rl) continue; // Skip if file invalid

      // Process line by line (Stream)
      for await (const line of rl) {
        if (!line.trim()) continue;

        try {
          const record = JSON.parse(line);
          const result = await syncSingleRecord(record);

          if (result.success) {
            syncResults.synced++;
            batchSynced++;
          } else {
            record.syncError = result.error; // Add error info
            batchFailures.push(record);
            syncResults.failed++;
          }
        } catch (e) {
          log('error', `Skipping malformed line in batch: ${e.message}`);
        }
      }

      // 4. Handle Batch Completion
      if (batchFailures.length === 0) {
        // Full success: Delete batch file
        await offlineStorage.deleteBatch(batchPath);
      } else {
        // Partial/Full failure: Requeue failed records to current pending file
        // and then delete the old batch file (since we moved the failed ones back)
        // This prevents infinite loops of bad files - they get re-appended to the end
        await offlineStorage.requeueFailedRecords(batchFailures);

        // Only delete if we successfully requeued (requeue method logs errors but doesn't throw)
        // For safety, we assume requeue worked if no crash.
        await offlineStorage.deleteBatch(batchPath);
      }

      // Report progress per batch
      if (io) {
        io.emit('sync_progress', {
          synced: syncResults.synced,
          failed: syncResults.failed,
          batch: path.basename(batchPath)
        });
      }
    }

    // Update cached pending count (Stats structure changed)
    const stats = await offlineStorage.getStats();
    syncResults.pending = stats.estimatedPendingRecords;
    cachedPendingCount = syncResults.pending;
    lastPendingCountUpdate = Date.now();

    log('success', `✅ Sync completed: ${syncResults.synced} synced, ${syncResults.failed} failed`);

    if (io) {
      io.emit('sync_complete', syncResults);
    }

    isSyncing = false;
    return syncResults;

  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    consecutiveFailures++;
    isSyncing = false;
    if (io) io.emit('sync_error', { error: error.message });
    return { ...syncResults, error: error.message };
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
  cachedPendingCount = stats.estimatedPendingRecords || stats.pendingSyncFiles; // Fallback or new prop
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
    consecutiveFailures,
    pendingRecords: stats.estimatedPendingRecords,
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
