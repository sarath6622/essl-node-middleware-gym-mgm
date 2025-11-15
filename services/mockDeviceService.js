const log = require("../utils/logger");
const { saveAttendanceRecord } = require("./firestoreService");
const DEVICE_CONFIG = require("../config/deviceConfig");
const { getDateInTimezone } = require("../utils/dateUtils");

let isConnected = false;
let mockPollingInterval = null;

// A small pool of mock users. In a real scenario, these would be in your DB.
const MOCK_USERS = {
  "MOCK-1": { name: "Alice Johnson", profileImageUrl: "https://i.pravatar.cc/150?u=alice", membershipPlanId: "premium_monthly", membershipStatus: "active" },
  "MOCK-2": { name: "Bob Williams", profileImageUrl: "https://i.pravatar.cc/150?u=bob", membershipPlanId: "basic_yearly", membershipStatus: "active" },
  "MOCK-3": { name: "Charlie Brown", profileImageUrl: "https://i.pravatar.cc/150?u=charlie", membershipPlanId: "premium_monthly", membershipStatus: "expired" },
  "MOCK-4": { name: "Charlie Brown", profileImageUrl: "https://i.pravatar.cc/150?u=charlie", membershipPlanId: "premium_monthly", membershipStatus: "expired" },
  "MOCK-5": { name: "Charlie Brown", profileImageUrl: "https://i.pravatar.cc/150?u=charlie", membershipPlanId: "premium_monthly", membershipStatus: "expired" },
  "MOCK-6": { name: "Charlie Brown", profileImageUrl: "https://i.pravatar.cc/150?u=charlie", membershipPlanId: "premium_monthly", membershipStatus: "expired" },
  "MOCK-7": { name: "Charlie Brown", profileImageUrl: "https://i.pravatar.cc/150?u=charlie", membershipPlanId: "premium_monthly", membershipStatus: "expired" },
};

async function connectToDevice(io) {
  log("info", "[MOCK] Connecting to mock device...");
  isConnected = true;
  io.emit("device_status", { connected: true, deviceIp: "mock-device", timestamp: new Date().toISOString() });
  log("success", "[MOCK] Mock device connected.");
  return true;
}

async function disconnectFromDevice() {
  log("info", "[MOCK] Disconnecting from mock device...");
  isConnected = false;
  stopPolling();
  log("success", "[MOCK] Mock device disconnected.");
}

function startPolling(io) {
  if (mockPollingInterval) return;

  log("info", "[MOCK] Starting mock attendance event polling (5-second intervals).");
  mockPollingInterval = setInterval(async () => {
    const mockUserIds = Object.keys(MOCK_USERS);
    const randomUserId = mockUserIds[Math.floor(Math.random() * mockUserIds.length)];
    const mockUserData = MOCK_USERS[randomUserId];
    
    const now = new Date();
    const timestamp = now.toISOString();

    const attendanceRecord = {
      userId: randomUserId,
      name: mockUserData.name,
      profileImageUrl: mockUserData.profileImageUrl,
      biometricDeviceId: "ESSL_MOCK_01",
      checkInTime: timestamp,
      checkOutTime: null,
      date: getDateInTimezone(timestamp, DEVICE_CONFIG.timezone),
      status: "present",
      source: "essl",
      membershipPlanId: mockUserData.membershipPlanId,
      membershipStatus: mockUserData.membershipStatus,
      remarks: "Mocked attendance entry",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    log("event", "[MOCK] 🎯 Mock attendance event generated:", attendanceRecord);

    io.emit("attendance_event", attendanceRecord);
    await saveAttendanceRecord(attendanceRecord);

  }, 5000);
}

function stopPolling() {
  if (mockPollingInterval) {
    clearInterval(mockPollingInterval);
    mockPollingInterval = null;
    log("info", "[MOCK] Mock polling stopped.");
  }
}

module.exports = {
  connectToDevice,
  disconnectFromDevice,
  startPolling,
  stopPolling,
  getZkInstance: () => null,
  isConnected: () => isConnected,
};
