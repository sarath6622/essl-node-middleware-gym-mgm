const { db } = require("../config/firebaseConfig");
const log = require("../utils/logger");

const ATTENDANCE_COLLECTION = "attendance_logs";

// Batch write queue
const writeQueue = [];
const BATCH_SIZE = 500; // Firestore max batch size
const BATCH_TIMEOUT = 2000; // 2 seconds max wait before forcing flush
let batchTimer = null;
let isFlushing = false;

/**
 * Flush the write queue using Firestore batch operations
 */
async function flushBatchQueue() {
  if (isFlushing || writeQueue.length === 0) {
    return;
  }

  isFlushing = true;

  try {
    // Take items from queue
    const itemsToWrite = writeQueue.splice(0, BATCH_SIZE);

    if (itemsToWrite.length === 0) {
      isFlushing = false;
      return;
    }

    log("info", `🔄 Flushing ${itemsToWrite.length} records to Firestore in batch...`);

    // Process in batches of 500 (Firestore limit)
    const batch = db.batch();
    const processedPaths = new Set();

    for (const { record, resolve, reject } of itemsToWrite) {
      try {
        const { userId, date } = record;
        const docPath = `${ATTENDANCE_COLLECTION}/${date}/records/${userId}`;

        // Skip duplicates within the same batch
        if (processedPaths.has(docPath)) {
          log("warning", `Duplicate within batch blocked for user ${userId} on ${date}`);
          resolve({ success: false, reason: "duplicate_in_batch" });
          continue;
        }

        const docRef = db.doc(docPath);
        batch.set(docRef, record, { merge: false }); // merge: false ensures create behavior
        processedPaths.add(docPath);

        // Mark as success (will resolve after batch commits)
        resolve({ success: true, path: docPath });
      } catch (error) {
        reject(error);
      }
    }

    // Commit the batch
    await batch.commit();
    log("success", `✅ Batch write completed: ${processedPaths.size} records saved to Firestore`);

  } catch (error) {
    log("error", "Batch write failed:", { errorMessage: error.message });

    // If batch fails, try individual writes as fallback
    log("warning", "Attempting individual writes as fallback...");
    for (const { record, resolve, reject } of writeQueue.splice(0, BATCH_SIZE)) {
      try {
        await saveAttendanceRecordDirect(record);
        resolve({ success: true, fallback: true });
      } catch (err) {
        reject(err);
      }
    }
  } finally {
    isFlushing = false;

    // If there are still items in queue, schedule next flush
    if (writeQueue.length > 0) {
      setImmediate(() => flushBatchQueue());
    }
  }
}

/**
 * Direct write without batching (fallback method)
 * @param {object} record The attendance record to save
 */
async function saveAttendanceRecordDirect(record) {
  const { userId, date } = record;
  const docPath = `${ATTENDANCE_COLLECTION}/${date}/records/${userId}`;
  const docRef = db.doc(docPath);

  try {
    await docRef.create(record);
    log("success", `📝 Record saved to Firestore path: ${docPath}`);
  } catch (error) {
    if (error.code === 6) {
      log("warning", `Duplicate check-in blocked for user ${userId} on ${date}.`);
    } else {
      throw error;
    }
  }
}

/**
 * Saves an attendance record using batched writes for better performance.
 * Records are queued and written in batches to reduce network calls.
 * @param {object} record The attendance record to save.
 * @param {boolean} immediate If true, bypass queue and write immediately
 */
async function saveAttendanceRecord(record, immediate = false) {
  if (!db) {
    log("error", "Firestore is not initialized. Cannot save attendance record.");
    return;
  }

  // Immediate write (bypass batching)
  if (immediate) {
    await saveAttendanceRecordDirect(record);
    return;
  }

  // Add to batch queue
  return new Promise((resolve, reject) => {
    writeQueue.push({ record, resolve, reject });

    // Clear existing timer
    if (batchTimer) {
      clearTimeout(batchTimer);
    }

    // Flush immediately if batch is full
    if (writeQueue.length >= BATCH_SIZE) {
      flushBatchQueue();
    } else {
      // Otherwise, wait for timeout
      batchTimer = setTimeout(() => {
        flushBatchQueue();
      }, BATCH_TIMEOUT);
    }
  });
}

/**
 * Force flush all pending writes immediately
 */
async function flushPendingWrites() {
  if (batchTimer) {
    clearTimeout(batchTimer);
    batchTimer = null;
  }
  await flushBatchQueue();
  log("info", "All pending writes flushed");
}

/**
 * Get batch queue statistics
 */
function getBatchStats() {
  return {
    queueSize: writeQueue.length,
    isFlushing,
    batchSize: BATCH_SIZE,
    batchTimeout: BATCH_TIMEOUT,
  };
}

module.exports = {
  saveAttendanceRecord,
  flushPendingWrites,
  getBatchStats,
};
