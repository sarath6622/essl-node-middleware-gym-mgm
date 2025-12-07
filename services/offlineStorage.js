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
    this.attendanceFile = path.join(this.storageDir, 'pending-attendance.json'); // Keeping .json extension for compatibility, but content is NDJSON
    this.usersFile = path.join(this.storageDir, 'users-cache.json');

    fs.ensureDirSync(this.storageDir);
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
      const newRecord = {
        ...attendanceData,
        recordId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9), // Unique ID for sync tracking
        offlineTimestamp: new Date().toISOString(),
        syncStatus: 'pending'
      };

      const line = JSON.stringify(newRecord) + '\n';
      await fs.appendFile(this.attendanceFile, line);
      
      log('info', `💾 Saved attendance offline (NDJSON): ${attendanceData.userId || attendanceData.userSn}`);
      return true;
    } catch (error) {
      log('error', `Failed to save offline attendance: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all pending offline attendance records
   * Reads line by line
   */
  async getPendingAttendance() {
    try {
      if (!await fs.pathExists(this.attendanceFile)) {
        return [];
      }

      const fileStream = fs.createReadStream(this.attendanceFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      const pendingRecords = [];

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record.syncStatus === 'pending') {
            pendingRecords.push(record);
          }
        } catch (e) {
          // Skip malformed lines
        }
      }

      return pendingRecords;
    } catch (error) {
      log('error', `Failed to get pending: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark attendance records as synced
   * Refactored to rewrite the NDJSON file excluding synced items
   */
  async markAsSynced(syncedIdsOrRecords) {
    try {
      if (!await fs.pathExists(this.attendanceFile)) {
        return;
      }

      const idsToSync = new Set(syncedIdsOrRecords.map(item => {
        if (typeof item === 'string') return item;
        if (item.recordId) return item.recordId; 
        if (item.dbId) return item.dbId;
        return null; 
      }).filter(Boolean));

      if (idsToSync.size === 0) return;

      // Read all, filter, rewrite (Maintenance cost is acceptable here)
      // For very large files, we could rename and stream-filter to new file, but loading into memory is fine for < 100MB
      
      const fileStream = fs.createReadStream(this.attendanceFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      const remainingLines = [];
      let syncedCount = 0;

      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (idsToSync.has(record.recordId) || idsToSync.has(record.dbId)) {
            syncedCount++;
          } else {
            remainingLines.push(line);
          }
        } catch (e) {
          // Keep malformed lines? No, better to drop them to self-heal
        }
      }

      if (syncedCount > 0) {
        // Atomic replace: Write to temp file then rename
        const tempFile = `${this.attendanceFile}.tmp`;
        const newContent = remainingLines.length > 0 ? remainingLines.join('\n') + '\n' : '';
        await fs.writeFile(tempFile, newContent);
        await fs.move(tempFile, this.attendanceFile, { overwrite: true });
        
        log('success', `✅ marked ${syncedCount} records as synced (removed from pending)`);
      }
      
    } catch (error) {
      log('error', `Failed to mark records as synced: ${error.message}`);
    }
  }

  /**
   * Clean up old synced records
   */
  async cleanupSyncedRecords() {
    return;
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
      let pendingCount = 0;
      let userCount = 0;
      let photoCount = 0;

      if (await fs.pathExists(this.attendanceFile)) {
        // Fast line counting
        const content = await fs.readFile(this.attendanceFile, 'utf-8');
        // Count non-empty lines
        pendingCount = content.split('\n').filter(line => line.trim().length > 0).length;
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
        pendingSync: pendingCount,
        cachedUsers: userCount,
        totalLogs: pendingCount,
        cachedPhotos: photoCount,
        storageType: 'NDJSON + FileSystem (Optimized)'
      };
    } catch (error) {
      return { pendingSync: 0, cachedUsers: 0 };
    }
  }
}

const offlineStorage = new OfflineStorageService();
module.exports = offlineStorage;

