/**
 * Offline Storage Service (NDJSON Version - O(1) Writes)
 * Manages local storage of attendance data using Append-Only JSON files
 */

const fs = require('fs-extra');
const path = require('path');
const log = require('../utils/logger');
const readline = require('readline');

class OfflineStorageService {
  constructor() {
    this.storageDir = null;
    this.attendanceFile = null;
    this.usersFile = null;
    this.init();
  }

  init() {
    const appDataPath = process.env.APPDATA ||
      (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');

    this.storageDir = path.join(appDataPath, 'ZK-Attendance', 'offline-data');
    this.batchesDir = path.join(this.storageDir, 'batches'); // New: Dedicated batches directory
    this.attendanceFile = path.join(this.storageDir, 'pending-attendance.json'); // Still the active write head
    this.usersFile = path.join(this.storageDir, 'users-cache.json');

    fs.ensureDirSync(this.storageDir);
    fs.ensureDirSync(this.batchesDir);
    this._migrateToNdjson();
  }

  /**
   * Internal: Migrate legacy JSON Array format to NDJSON
   * This runs once on startup to ensure we don't append to a JSON array
   */
  async _migrateToNdjson() {
    try {
      if (!await fs.pathExists(this.attendanceFile)) return;

      const stats = await fs.stat(this.attendanceFile);
      if (stats.size === 0) return;

      // Read first byte to check format
      const fd = await fs.open(this.attendanceFile, 'r');
      const buffer = Buffer.alloc(1);
      await fs.read(fd, buffer, 0, 1, 0);
      await fs.close(fd);

      const firstChar = buffer.toString('utf8').trim();

      // If it starts with '[', it's a JSON array (legacy)
      if (firstChar === '[') {
        log('info', '📦 Migrating legacy offline storage to High-Performance NDJSON format...');
        const content = await fs.readFile(this.attendanceFile, 'utf-8');
        let data = [];
        try {
          data = JSON.parse(content);
        } catch (e) {
          log('error', 'Failed to parse legacy storage during migration. Backing up and resetting.');
          await fs.move(this.attendanceFile, `${this.attendanceFile}.corrupt.bak`);
          return;
        }

        // Rewrite as NDJSON
        const ndjsonContent = data.map(record => JSON.stringify(record)).join('\n') + '\n';
        await fs.writeFile(this.attendanceFile, ndjsonContent);
        log('success', `✅ Migration complete. Converted ${data.length} records to NDJSON.`);
      }
    } catch (error) {
      log('error', `Storage migration failed: ${error.message}`);
    }
  }

  /**
   * Save attendance event to offline storage
   * PERFORMANCE: O(1) - Appends a single line instead of rewriting the whole file
   */
  async saveOfflineAttendance(attendanceData) {
    try {
      // If we are strictly offline-first, we don't strictly need 'syncStatus' inside the object 
      // because separation is done by file location (pending file vs batch file), 
      // but keeping it doesn't hurt.
      const newRecord = {
        ...attendanceData,
        recordId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
        offlineTimestamp: new Date().toISOString(),
        syncStatus: 'pending'
      };

      const line = JSON.stringify(newRecord) + '\n';
      await fs.appendFile(this.attendanceFile, line);

      log('info', `💾 Saved attendance offline: ${attendanceData.userId || attendanceData.userSn}`);
      return true;
    } catch (error) {
      log('error', `Failed to save offline attendance: ${error.message}`);
      return false;
    }
  }

  /**
   * ROTATE LOGS (Atomic Operation)
   * Renames the current pending file to a batch file for processing.
   * This guarantees that new writes go to a new empty file, isolationg the batch.
   */
  async rotatePendingFile() {
    try {
      if (!await fs.pathExists(this.attendanceFile)) {
        return null;
      }

      const stats = await fs.stat(this.attendanceFile);
      if (stats.size === 0) return null;

      const timestamp = Date.now();
      const batchFileName = `batch-${timestamp}.ndjson`;
      const batchPath = path.join(this.batchesDir, batchFileName);

      // Atomic rename
      await fs.rename(this.attendanceFile, batchPath);
      log('info', `🔄 Rotated pending log to batch: ${batchFileName}`);
      return batchPath;
    } catch (error) {
      log('error', `Failed to rotate pending file: ${error.message}`);
      return null;
    }
  }

  /**
   * Get list of all batch files waiting to be processed
   */
  async getBatches() {
    try {
      const files = await fs.readdir(this.batchesDir);
      return files
        .filter(f => f.startsWith('batch-') && f.endsWith('.ndjson'))
        .map(f => path.join(this.batchesDir, f))
        .sort(); // Oldest first
    } catch (error) {
      log('error', `Failed to list batches: ${error.message}`);
      return [];
    }
  }

  /**
   * Create a read stream interface for a batch file
   * This allows processing line-by-line without loading 100MB into RAM
   */
  createBatchStream(batchPath) {
    if (!fs.existsSync(batchPath)) return null;
    const fileStream = fs.createReadStream(batchPath);
    return readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
  }

  /**
   * Re-queue failed records back to the MAIN pending file
   */
  async requeueFailedRecords(records) {
    if (!records || records.length === 0) return;
    try {
      const lines = records.map(r => JSON.stringify(r)).join('\n') + '\n';
      await fs.appendFile(this.attendanceFile, lines);
      log('warning', `↩️ Re-queued ${records.length} failed records to pending file`);
    } catch (error) {
      log('error', `CRITICAL: Failed to requeue records: ${error.message}`);
    }
  }

  /**
   * Delete a processed batch file
   */
  async deleteBatch(batchPath) {
    try {
      await fs.unlink(batchPath);
      // log('debug', `🗑️ Deleted processed batch: ${path.basename(batchPath)}`);
    } catch (error) {
      log('error', `Failed to delete batch ${batchPath}: ${error.message}`);
    }
  }

  /**
   * Cache user data (Users are still small enough for standard JSON)
   */
  async cacheUsers(users) {
    try {
      if (!users || !Array.isArray(users)) return;

      const cacheData = {
        updatedAt: new Date().toISOString(),
        users: users
      };

      await fs.writeJson(this.usersFile, cacheData, { spaces: 2 });
      log('info', `💾 Cached ${users.length} users in JSON`);
    } catch (error) {
      log('error', `Failed to cache users: ${error.message}`);
    }
  }

  /**
   * Get cached users
   */
  async getCachedUsers(silent = false) {
    try {
      if (!await fs.pathExists(this.usersFile)) {
        return [];
      }

      const data = await fs.readJson(this.usersFile);
      if (data && Array.isArray(data.users)) {
        if (!silent) log('debug', `📦 Retrieved ${data.users.length} users from JSON cache`);
        return data.users;
      }
      return [];
    } catch (error) {
      if (!silent) console.error(error);
      return [];
    }
  }

  /**
   * Ensure user photo is saved to disk and return the relative path
   * @param {string} userId - The user ID
   * @param {string} base64Data - The base64 image data (with or without prefix)
   * @returns {Promise<string|null>} - The relative path to the image or null on failure
   */
  async saveUserPhoto(userId, base64Data) {
    try {
      if (!userId || !base64Data) return null;

      const photoDir = path.join(this.storageDir, 'photos');
      await fs.ensureDir(photoDir);

      // Strip prefix if present (e.g., "data:image/jpeg;base64,")
      const base64Image = base64Data.split(';base64,').pop();
      const buffer = Buffer.from(base64Image, 'base64');

      const fileName = `${userId}.jpg`;
      const filePath = path.join(photoDir, fileName);

      await fs.writeFile(filePath, buffer);

      // Return relative path for portability
      return `photos/${fileName}`;
    } catch (error) {
      log('error', `Failed to save photo for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get user photo as base64 string (for compatibility)
   * @param {string} relativePath - Relative path stored in user object
   * @returns {Promise<string|null>} - Base64 string with prefix
   */
  async getUserPhoto(relativePath) {
    try {
      if (!relativePath) return null;

      const filePath = path.join(this.storageDir, relativePath);

      if (!await fs.pathExists(filePath)) {
        return null;
      }

      const buffer = await fs.readFile(filePath);
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
    } catch (error) {
      log('error', `Failed to read photo from ${relativePath}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    try {
      let pendingLines = 0;
      let batchCount = 0;
      let userCount = 0;
      let photoCount = 0;

      if (await fs.pathExists(this.attendanceFile)) {
        // Just checking size might be faster than reading lines for stats
        const stats = await fs.stat(this.attendanceFile);
        pendingLines = Math.ceil(stats.size / 150); // Rough estimate
      }

      if (await fs.pathExists(this.batchesDir)) {
        const files = await fs.readdir(this.batchesDir);
        batchCount = files.filter(f => f.endsWith('.ndjson')).length;
      }

      if (await fs.pathExists(this.usersFile)) {
        const data = await fs.readJson(this.usersFile);
        if (data && Array.isArray(data.users)) userCount = data.users.length;
      }

      const photoDir = path.join(this.storageDir, 'photos');
      if (await fs.pathExists(photoDir)) {
        const files = await fs.readdir(photoDir);
        photoCount = files.length;
      }

      return {
        pendingSyncFiles: batchCount,
        estimatedPendingRecords: pendingLines + (batchCount * 50), // Rough guess
        cachedUsers: userCount,
        cachedPhotos: photoCount,
        storageType: 'Log Rotation (Atomic)'
      };
    } catch (error) {
      return { pendingSyncFiles: 0, cachedUsers: 0 };
    }
  }
}

const offlineStorage = new OfflineStorageService();
module.exports = offlineStorage;

