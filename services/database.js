/**
 * Database Service
 * Manages SQLite database connection and schema
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs-extra');
const log = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.db = null;
    this.initialized = false;
  }

  /**
   * Initialize database
   */
  init() {
    if (this.initialized) return;

    try {
      // Determine storage path (same logic as before to keep it in AppData)
      const appDataPath = process.env.APPDATA ||
        (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');
      
      const storageDir = path.join(appDataPath, 'ZK-Attendance', 'database');
      fs.ensureDirSync(storageDir);

      const dbPath = path.join(storageDir, 'attendance.db');
      log('info', `📂 Opening database at: ${dbPath}`);

      // Fix for pkg/Tauri sidecar: explicitly load native binding from executable directory
      let options = {};
      // Check if .node file exists next to the executable (where we put it in prepare-sidecar.js)
      const bindingPath = path.join(path.dirname(process.execPath), 'better_sqlite3.node');
      
      // Also check local node_modules fallback for development
      const localBinding = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node');

      if (fs.existsSync(bindingPath)) {
          log('info', `🔌 Using native binding: ${bindingPath}`);
          options.nativeBinding = bindingPath;
      } else if (fs.existsSync(localBinding)) {
           // This helps in non-packaged runs if needed, though usually standard resolution works
           // options.nativeBinding = localBinding; 
      }

      this.db = new Database(dbPath, options);
      
      // Enable WAL mode for better performance
      this.db.pragma('journal_mode = WAL');

      this.createTables();
      this.initialized = true;
      log('info', '✅ Database initialized successfully');
    } catch (error) {
      log('error', `Failed to initialize database: ${error.message}`);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  createTables() {
    // 1. Attendance Logs
    // Stores raw events from the device
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS attendance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        device_ip TEXT,
        sync_status TEXT DEFAULT 'pending', -- pending, synced, failed
        synced_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        metadata TEXT -- JSON string for extra fields
      )
    `);

    // 2. Users
    // Cache for user details to show beautiful UI offline
    // Re-create table if missing column (simple migration: drop if exists for now since it is just cache)
    // For safety in this patch, we will just alter or better: let's drop and recreate since it's a cache.
    this.db.exec(`DROP TABLE IF EXISTS users`);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        biometric_device_id TEXT, -- Added field
        card_number TEXT,
        privilege INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 3. Key-Value Store
    // For app config, sync timestamps, etc.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS key_value_store (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Indices for performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_logs_status ON attendance_logs(sync_status);
      CREATE INDEX IF NOT EXISTS idx_logs_user ON attendance_logs(user_id);
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON attendance_logs(timestamp);
    `);
  }

  /**
   * Get database instance
   */
  getInstance() {
    if (!this.initialized) this.init();
    return this.db;
  }

  /**
   * Prepare a statement
   */
  prepare(sql) {
    if (!this.initialized) this.init();
    return this.db.prepare(sql);
  }

  /**
   * Execute a transaction
   */
  transaction(fn) {
    if (!this.initialized) this.init();
    return this.db.transaction(fn);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.initialized = false;
    }
  }
}

// Singleton instance
const dbService = new DatabaseService();

module.exports = dbService;
