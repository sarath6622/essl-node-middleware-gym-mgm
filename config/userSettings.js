/**
 * User Settings Service
 * Manages user-configurable settings that persist across application restarts
 */

const fs = require('fs-extra');
const path = require('path');
const log = require('../utils/logger');

// Default settings
const DEFAULT_SETTINGS = {
    connectionType: 'wifi', // 'wifi' (auto-scan) or 'wired' (static IP)
    staticIP: '',
    staticPort: 4370
};

// Settings file path
let settingsPath = null;

/**
 * Get the path to the settings file
 */
function getSettingsPath() {
    if (settingsPath) return settingsPath;

    const appDataPath = process.env.APPDATA ||
        (process.platform === 'darwin' ? process.env.HOME + '/Library/Application Support' : '/var/local');

    const settingsDir = path.join(appDataPath, 'ZK-Attendance');
    fs.ensureDirSync(settingsDir);

    settingsPath = path.join(settingsDir, 'user-settings.json');
    return settingsPath;
}

/**
 * Load settings from disk
 * @returns {Object} The user settings object
 */
function getSettings() {
    try {
        const filePath = getSettingsPath();

        if (!fs.existsSync(filePath)) {
            log('info', '📝 No settings file found, using defaults');
            return { ...DEFAULT_SETTINGS };
        }

        const data = fs.readJsonSync(filePath);
        log('info', `📝 Settings loaded: ${data.connectionType} mode`);

        // Merge with defaults to ensure all fields exist
        return { ...DEFAULT_SETTINGS, ...data };
    } catch (error) {
        log('error', `Failed to load settings: ${error.message}`);
        return { ...DEFAULT_SETTINGS };
    }
}

/**
 * Save settings to disk
 * @param {Object} settings The settings object to save
 * @returns {boolean} True if saved successfully
 */
function saveSettings(settings) {
    try {
        const filePath = getSettingsPath();

        // Validate settings
        if (!settings.connectionType || !['wifi', 'wired'].includes(settings.connectionType)) {
            throw new Error('Invalid connection type');
        }

        if (settings.connectionType === 'wired' && !settings.staticIP) {
            throw new Error('Static IP is required for wired connection');
        }

        // Ensure port is a number
        const settingsToSave = {
            connectionType: settings.connectionType,
            staticIP: settings.staticIP || '',
            staticPort: parseInt(settings.staticPort, 10) || 4370
        };

        fs.writeJsonSync(filePath, settingsToSave, { spaces: 2 });
        log('success', `✅ Settings saved: ${settingsToSave.connectionType} mode${settingsToSave.connectionType === 'wired' ? ` (${settingsToSave.staticIP}:${settingsToSave.staticPort})` : ''}`);

        return true;
    } catch (error) {
        log('error', `Failed to save settings: ${error.message}`);
        throw error;
    }
}

/**
 * Apply settings to device config
 * @param {Object} settings User settings
 * @param {Object} deviceConfig The device config object to modify
 */
function applySettingsToConfig(settings, deviceConfig) {
    if (settings.connectionType === 'wired') {
        // Wired mode: use static IP, disable auto-discovery
        deviceConfig.autoDiscoverDevice = false;
        deviceConfig.ip = settings.staticIP;
        deviceConfig.port = settings.staticPort || 4370;
        log('info', `🔌 Wired mode enabled: ${settings.staticIP}:${deviceConfig.port}`);
    } else {
        // WiFi mode: enable auto-discovery
        deviceConfig.autoDiscoverDevice = true;
        log('info', '📡 WiFi mode enabled: Auto-scan for devices');
    }
}

module.exports = {
    getSettings,
    saveSettings,
    getSettingsPath,
    applySettingsToConfig,
    DEFAULT_SETTINGS
};
