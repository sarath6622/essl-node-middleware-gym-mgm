const log = require("../utils/logger");
const { saveAttendanceRecord } = require("./firestoreService");
const DEVICE_CONFIG = require("../config/deviceConfig");
const { getDateInTimezone } = require("../utils/dateUtils");

let isConnected = false;
let mockPollingInterval = null;

// A small pool of mock users. In a real scenario, these would be in your DB.
// Generate 50 distinct mock users
const MOCK_USERS = {};
const FIRST_NAMES = ["James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen", "Christopher", "Nancy", "Daniel", "Lisa", "Matthew", "Betty", "Anthony", "Margaret", "Mark", "Sandra", "Donald", "Ashley", "Steven", "Kimberly", "Paul", "Emily", "Andrew", "Donna", "Joshua", "Michelle", "Kenneth", "Dorothy", "Kevin", "Carol", "Brian", "Amanda", "George", "Melissa", "Edward", "Deborah"];
const LAST_NAMES = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez", "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin", "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson", "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores", "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts"];

for (let i = 1; i <= 50; i++) {
  const firstName = FIRST_NAMES[(i - 1) % FIRST_NAMES.length];
  const lastName = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]; // Random last name
  const fullName = `${firstName} ${lastName}`;
  const userId = `MOCK-${i.toString().padStart(3, '0')}`;

  MOCK_USERS[userId] = {
    name: fullName,
    membershipPlanId: i % 3 === 0 ? "platinum_yearly" : (i % 2 === 0 ? "premium_monthly" : "basic_yearly"),
    membershipStatus: i % 10 === 0 ? "expired" : (i % 15 === 0 ? "pending" : "active") // Mostly active
  };
}

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

  // Default to 15 seconds if not configured
  const interval = DEVICE_CONFIG.mockInterval || 15000;

  log("info", `[MOCK] Starting mock attendance event polling (${interval / 1000}-second intervals).`);
  mockPollingInterval = setInterval(async () => {
    const mockUserIds = Object.keys(MOCK_USERS);
    const randomUserId = mockUserIds[Math.floor(Math.random() * mockUserIds.length)];
    const mockUserData = MOCK_USERS[randomUserId];

    const now = new Date();
    const timestamp = now.toISOString();

    const attendanceRecord = {
      userId: randomUserId,
      name: mockUserData.name,
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

  }, interval);
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
