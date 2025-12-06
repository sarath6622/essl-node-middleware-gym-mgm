/**
 * Offline Storage Service (JSON Version)
 * Manages local storage of attendance data using JSON files
 */

const fs = require('fs-extra');
const path = require('path');
const log = require('../utils/logger');

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
    this.attendanceFile = path.join(this.storageDir, 'pending-attendance.json');
    this.usersFile = path.join(this.storageDir, 'users-cache.json');

    fs.ensureDirSync(this.storageDir);
  }

  /**
   * Save attendance event to offline storage
   */
  async saveOfflineAttendance(attendanceData) {
    try {
      let currentData = [];
      if (await fs.pathExists(this.attendanceFile)) {
        const fileContent = await fs.readFile(this.attendanceFile, 'utf-8');
        try {
          currentData = JSON.parse(fileContent);
          if (!Array.isArray(currentData)) currentData = [];
        } catch (e) {
          currentData = [];
        }
      }

      const newRecord = {
        ...attendanceData,
        recordId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9), // Unique ID for sync tracking
        offlineTimestamp: new Date().toISOString(),
        syncStatus: 'pending'
      };

      currentData.push(newRecord);
      
      await fs.writeJson(this.attendanceFile, currentData, { spaces: 2 });
      log('info', `💾 Saved attendance offline (JSON): ${attendanceData.userId || attendanceData.userSn}`);
      return true;
    } catch (error) {
      log('error', `Failed to save offline attendance: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all pending offline attendance records
   */
  async getPendingAttendance() {
    try {
      if (!await fs.pathExists(this.attendanceFile)) {
        return [];
      }

      const fileContent = await fs.readFile(this.attendanceFile, 'utf-8');
      const data = JSON.parse(fileContent);
      
      if (!Array.isArray(data)) return [];

      return data.filter(record => record.syncStatus === 'pending');
    } catch (error) {
      log('error', `Failed to get pending: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark attendance records as synced
   */
  async markAsSynced(syncedIdsOrRecords) {
    try {
      if (!await fs.pathExists(this.attendanceFile)) {
        return;
      }

      let currentData = await fs.readJson(this.attendanceFile);
      if (!Array.isArray(currentData)) return;

      // Extract IDs to match. syncedIdsOrRecords could be IDs or objects depending on caller 
      // (Compatibility with old logic: usually it passed timestamps or objects)
      // We will try to match loosely for robustness during migration
      
      const idsToSync = new Set(syncedIdsOrRecords.map(item => {
        if (typeof item === 'string') return item;
        if (item.recordId) return item.recordId; 
        if (item.dbId) return item.dbId; // From previous step if we passed dbId
        return null; 
      }).filter(Boolean));

      // Filter out synced items (remove them from pending file entirely or mark as synced? 
      // Let's remove them to keep file size small, or move to 'synced-history.json' if needed. 
      // For now, removing is safer for performance)
      
      const initialCount = currentData.length;
      
      // If we want to keep history, we could mark them. But let's just remove them to emulate "Synced and Cleaned" 
      // OR we mark them as synced and have a cleanup job.
      // Let's keep it simple: Remove them.
      
      const remainingData = currentData.filter(record => !idsToSync.has(record.recordId) && !idsToSync.has(record.dbId));
      
      if (remainingData.length < initialCount) {
        await fs.writeJson(this.attendanceFile, remainingData, { spaces: 2 });
        log('success', `✅ Marked ${initialCount - remainingData.length} records as synced (removed from pending)`);
      }
      
    } catch (error) {
      log('error', `Failed to mark records as synced: ${error.message}`);
    }
  }

  /**
   * Clean up old synced records (Not needed if we delete them on sync, but kept for interface compatibility)
   */
  async cleanupSyncedRecords() {
    // No-op since we delete on sync now
    return;
  }

  /**
   * Cache user data
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
   * Get storage statistics
   */
  async getStats() {
    try {
      let pendingCount = 0;
      let userCount = 0;

      if (await fs.pathExists(this.attendanceFile)) {
        const data = await fs.readJson(this.attendanceFile);
        if (Array.isArray(data)) pendingCount = data.length;
      }

      if (await fs.pathExists(this.usersFile)) {
        const data = await fs.readJson(this.usersFile);
        if (data && Array.isArray(data.users)) userCount = data.users.length;
      }

      return {
        pendingSync: pendingCount,
        cachedUsers: userCount,
        totalLogs: pendingCount, // Rough approx since we delete synced
        storageType: 'JSON'
      };
    } catch (error) {
      return { pendingSync: 0, cachedUsers: 0 };
    }
  }
}

const offlineStorage = new OfflineStorageService();
module.exports = offlineStorage;

