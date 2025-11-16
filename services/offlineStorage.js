/**
 * Offline Storage Service
 * Manages local storage of attendance data when Firebase is unavailable
 */

const fs = require('fs').promises;
const path = require('path');
const log = require('../utils/logger');

class OfflineStorageService {
  constructor() {
    // Store offline data in user's app data directory
    const appDataPath = process.env.APPDATA ||
                        (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
    this.storageDir = path.join(appDataPath, 'ZK-Attendance', 'offline-data');
    this.attendanceFile = path.join(this.storageDir, 'pending-attendance.json');
    this.cacheFile = path.join(this.storageDir, 'users-cache.json');
    this.initialized = false;
  }

  /**
   * Initialize offline storage directory
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.initialized = true;
      log('info', '📦 Offline storage initialized');
    } catch (error) {
      log('error', `Failed to initialize offline storage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save attendance event to offline storage
   * @param {Object} attendanceData - Attendance event data
   */
  async saveOfflineAttendance(attendanceData) {
    await this.initialize();

    try {
      // Read existing offline data
      let offlineData = [];
      try {
        const data = await fs.readFile(this.attendanceFile, 'utf-8');
        offlineData = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet, start with empty array
        offlineData = [];
      }

      // Add new attendance with timestamp
      offlineData.push({
        ...attendanceData,
        offlineTimestamp: new Date().toISOString(),
        syncStatus: 'pending'
      });

      // Write back to file
      await fs.writeFile(this.attendanceFile, JSON.stringify(offlineData, null, 2));
      log('info', `💾 Saved attendance offline: ${attendanceData.userName || attendanceData.userId}`);

      return true;
    } catch (error) {
      log('error', `Failed to save offline attendance: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all pending offline attendance records
   * @returns {Array} Array of pending attendance records
   */
  async getPendingAttendance() {
    await this.initialize();

    try {
      const data = await fs.readFile(this.attendanceFile, 'utf-8');
      const offlineData = JSON.parse(data);
      return offlineData.filter(record => record.syncStatus === 'pending');
    } catch (error) {
      // No offline data yet
      return [];
    }
  }

  /**
   * Mark attendance records as synced
   * @param {Array} syncedIds - Array of record IDs that were synced
   */
  async markAsSynced(syncedIds) {
    await this.initialize();

    try {
      const data = await fs.readFile(this.attendanceFile, 'utf-8');
      let offlineData = JSON.parse(data);

      // Mark synced records
      offlineData = offlineData.map(record => {
        if (syncedIds.includes(record.offlineTimestamp)) {
          return { ...record, syncStatus: 'synced', syncedAt: new Date().toISOString() };
        }
        return record;
      });

      await fs.writeFile(this.attendanceFile, JSON.stringify(offlineData, null, 2));
      log('success', `✅ Marked ${syncedIds.length} records as synced`);
    } catch (error) {
      log('error', `Failed to mark records as synced: ${error.message}`);
    }
  }

  /**
   * Clear old synced records (older than 7 days)
   */
  async cleanupSyncedRecords() {
    await this.initialize();

    try {
      const data = await fs.readFile(this.attendanceFile, 'utf-8');
      let offlineData = JSON.parse(data);

      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      // Keep only recent synced records and all pending records
      offlineData = offlineData.filter(record => {
        if (record.syncStatus === 'pending') return true;
        if (record.syncedAt && new Date(record.syncedAt) > sevenDaysAgo) return true;
        return false;
      });

      await fs.writeFile(this.attendanceFile, JSON.stringify(offlineData, null, 2));
      log('info', '🧹 Cleaned up old synced records');
    } catch (error) {
      // File might not exist, that's fine
    }
  }

  /**
   * Cache user data for offline access
   * @param {Array} users - Array of user objects
   */
  async cacheUsers(users) {
    await this.initialize();

    try {
      const cacheData = {
        users,
        cachedAt: new Date().toISOString()
      };

      await fs.writeFile(this.cacheFile, JSON.stringify(cacheData, null, 2));
      log('info', `💾 Cached ${users.length} users for offline access`);
    } catch (error) {
      log('error', `Failed to cache users: ${error.message}`);
    }
  }

  /**
   * Get cached users
   * @returns {Array} Array of cached user objects
   */
  async getCachedUsers() {
    await this.initialize();

    try {
      const data = await fs.readFile(this.cacheFile, 'utf-8');
      const cacheData = JSON.parse(data);

      log('info', `📦 Retrieved ${cacheData.users.length} users from cache (cached at: ${cacheData.cachedAt})`);
      return cacheData.users;
    } catch (error) {
      log('warning', 'No cached users available');
      return [];
    }
  }

  /**
   * Get offline storage statistics
   * @returns {Object} Storage statistics
   */
  async getStats() {
    await this.initialize();

    try {
      const attendanceData = await this.getPendingAttendance();
      const cachedUsers = await this.getCachedUsers();

      return {
        pendingSync: attendanceData.length,
        cachedUsers: cachedUsers.length,
        storageLocation: this.storageDir
      };
    } catch (error) {
      return {
        pendingSync: 0,
        cachedUsers: 0,
        storageLocation: this.storageDir
      };
    }
  }

  /**
   * Export all offline data for backup
   * @param {string} exportPath - Path to export file
   */
  async exportData(exportPath) {
    await this.initialize();

    try {
      const pending = await this.getPendingAttendance();
      const users = await this.getCachedUsers();

      const exportData = {
        exportedAt: new Date().toISOString(),
        pendingAttendance: pending,
        cachedUsers: users
      };

      await fs.writeFile(exportPath, JSON.stringify(exportData, null, 2));
      log('success', `✅ Exported offline data to: ${exportPath}`);
      return true;
    } catch (error) {
      log('error', `Failed to export offline data: ${error.message}`);
      return false;
    }
  }
}

// Singleton instance
const offlineStorage = new OfflineStorageService();

module.exports = offlineStorage;
