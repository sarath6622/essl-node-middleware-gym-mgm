/**
 * Offline Storage Service (SQLite Version)
 * Manages local storage of attendance data using SQLite
 */

const db = require('./database');
const log = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');

class OfflineStorageService {
  constructor() {
    // Initialize DB on first use
    db.init();
    this.migrateLegacyData();
  }

  /**
   * Migrate data from old JSON files to SQLite
   */
  async migrateLegacyData() {
    try {
      // Check if migration already happened
      const row = db.prepare("SELECT value FROM key_value_store WHERE key = 'legacy_migration_done'").get();
      if (row && row.value === 'true') return;

      log('info', '🔄 Checking for legacy JSON data to migrate...');

      const appDataPath = process.env.APPDATA ||
        (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
      const oldStorageDir = path.join(appDataPath, 'ZK-Attendance', 'offline-data');
      const attendanceFile = path.join(oldStorageDir, 'pending-attendance.json');
      const cacheFile = path.join(oldStorageDir, 'users-cache.json');

      // Migrate Pending Attendance
      if (await fs.pathExists(attendanceFile)) {
        const data = await fs.readFile(attendanceFile, 'utf-8');
        try {
          const records = JSON.parse(data);
          if (!Array.isArray(records)) {
            log('warning', '⚠️ Legacy attendance file is not an array, skipping migration');
            return;
          }

          const insertStmt = db.prepare(`
            INSERT INTO attendance_logs (user_id, timestamp, device_ip, sync_status, created_at, metadata)
            VALUES (@userId, @timestamp, @deviceIp, 'pending', @created_at, @metadata)
          `);

          const transaction = db.transaction((records) => {
            for (const record of records) {
              if (!record) continue;
              if (record.syncStatus === 'pending') {
                insertStmt.run({
                  userId: record.userId || record.userSn || 'unknown',
                  timestamp: record.timestamp || new Date().toISOString(),
                  deviceIp: record.ip || 'unknown',
                  created_at: record.offlineTimestamp || new Date().toISOString(),
                  metadata: JSON.stringify(record)
                });
                count++;
              }
            }
          });

          transaction(records);
          log('success', `✅ Migrated ${count} pending records from JSON to SQLite`);
        } catch (e) {
          log('error', `Failed to migrate attendance JSON: ${e.message}`);
        }
      }

      // Migrate User Cache
      if (await fs.pathExists(cacheFile)) {
        const data = await fs.readFile(cacheFile, 'utf-8');
        try {
          const cache = JSON.parse(data);
          if (cache.users && Array.isArray(cache.users)) {
            await this.cacheUsers(cache.users);
            log('success', `✅ Migrated ${cache.users.length} users from JSON to SQLite`);
          }
        } catch (e) {
          log('error', `Failed to migrate user cache JSON: ${e.message}`);
        }
      }

      // Mark migration as done
      db.prepare("INSERT OR REPLACE INTO key_value_store (key, value) VALUES ('legacy_migration_done', 'true')").run();

    } catch (error) {
      log('error', `Migration error: ${error.message}`);
    }
  }

  /**
   * Save attendance event to offline storage
   */
  async saveOfflineAttendance(attendanceData) {
    try {
      const stmt = db.prepare(`
        INSERT INTO attendance_logs (user_id, timestamp, device_ip, sync_status, metadata)
        VALUES (@userId, @timestamp, @deviceIp, 'pending', @metadata)
      `);

      stmt.run({
        userId: attendanceData.userId || attendanceData.userSn || 'unknown',
        timestamp: attendanceData.timestamp || new Date().toISOString(),
        deviceIp: attendanceData.ip || 'unknown',
        metadata: JSON.stringify(attendanceData)
      });

      log('info', `💾 Saved attendance offline (SQLite): ${attendanceData.userId}`);
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
      const rows = db.prepare("SELECT * FROM attendance_logs WHERE sync_status = 'pending'").all();
      
      // Map back to format expected by sync service
      return rows.map(row => {
        let metadata = {};
        try { metadata = JSON.parse(row.metadata); } catch(e){}
        
        return {
          ...metadata, // original data
          dbId: row.id, // internal DB ID
          offlineTimestamp: row.created_at // match old field name for compatibility
        };
      });
    } catch (error) {
      log('error', `Failed to get pending: ${error.message}`);
      return [];
    }
  }

  /**
   * Mark attendance records as synced
   */
  async markAsSynced(syncedIds) {
    try {
      // syncedIds used to be timestamps strings, now let's handle if they are passed as DB IDs
      // Update: syncService will be updated to pass DB IDs, but for backward compat/transition let's handle carefully.
      
      // We will update syncService to return the 'dbId' we sent it.
      
      const updateStmt = db.prepare(`
        UPDATE attendance_logs 
        SET sync_status = 'synced', synced_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `);

      const transaction = db.transaction((ids) => {
        for (const id of ids) {
          updateStmt.run(id);
        }
      });

      transaction(syncedIds);
      log('success', `✅ Marked ${syncedIds.length} records as synced`);
    } catch (error) {
      log('error', `Failed to mark records as synced: ${error.message}`);
    }
  }

  /**
   * Clear old synced records (older than 30 days - increased from 7 since we have DB now)
   */
  async cleanupSyncedRecords() {
    try {
      const result = db.prepare(`
        DELETE FROM attendance_logs 
        WHERE sync_status = 'synced' 
        AND synced_at < datetime('now', '-30 days')
      `).run();

      if (result.changes > 0) {
        log('info', `🧹 Cleaned up ${result.changes} old synced records`);
      }
    } catch (error) {
      log('error', `Cleanup failed: ${error.message}`);
    }
  }

  /**
   * Cache user data
   */
  async cacheUsers(users) {
    try {
      const insertStmt = db.prepare(`
        INSERT OR REPLACE INTO users (id, name, biometric_device_id, card_number, privilege)
        VALUES (@userId, @name, @biometricDeviceId, @cardNumber, @privilege)
      `);

      const transaction = db.transaction((userList) => {
        for (const user of userList) {
          insertStmt.run({
            userId: user.userId || user.sn || user.id, // Handle variations
            name: user.name,
            biometricDeviceId: user.biometricDeviceId, // New field
            cardNumber: user.cardNumber || user.cardno,
            privilege: user.privilege || 0
          });
        }
      });

      transaction(users);
      log('info', `💾 Cached ${users.length} users in SQLite`);
    } catch (error) {
      log('error', `Failed to cache users: ${error.message}`);
    }
  }

  /**
   * Get cached users
   */
  async getCachedUsers(silent = false) {
    try {
      const users = db.prepare("SELECT * FROM users").all();
      
      // Map helper to restore camelCase properties
      const mappedUsers = users.map(u => ({
        id: u.id,
        name: u.name,
        biometricDeviceId: u.biometric_device_id, // Map back
        cardNumber: u.card_number,
        privilege: u.privilege,
        updatedAt: u.updated_at
      }));

      if (!silent) {
        log('debug', `📦 Retrieved ${mappedUsers.length} users from SQLite cache`);
      }
      return mappedUsers;
    } catch (error) {
      console.error(error);
      return [];
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    try {
      const pendingCount = db.prepare("SELECT COUNT(*) as count FROM attendance_logs WHERE sync_status = 'pending'").get().count;
      const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get().count;
      const totalLogs = db.prepare("SELECT COUNT(*) as count FROM attendance_logs").get().count;

      return {
        pendingSync: pendingCount,
        cachedUsers: userCount,
        totalLogs: totalLogs,
        storageType: 'SQLite'
      };
    } catch (error) {
      return { pendingSync: 0, cachedUsers: 0 };
    }
  }
}

const offlineStorage = new OfflineStorageService();
module.exports = offlineStorage;
