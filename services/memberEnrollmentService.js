const { realtimeDb } = require("../config/firebaseConfig");
const log = require("../utils/logger");

let deviceService = null;

// Enrollment queue
const enrollmentQueue = [];
let isProcessingQueue = false;
const MAX_CONCURRENT_ENROLLMENTS = 3; // Process 3 enrollments at a time

/**
 * Process enrollment queue with concurrency control
 */
async function processEnrollmentQueue() {
  if (isProcessingQueue || enrollmentQueue.length === 0) {
    return;
  }

  isProcessingQueue = true;

  try {
    while (enrollmentQueue.length > 0) {
      // Take batch of items from queue
      const batch = enrollmentQueue.splice(0, MAX_CONCURRENT_ENROLLMENTS);

      log("info", `🔄 Processing ${batch.length} enrollment(s) from queue (${enrollmentQueue.length} remaining)...`);

      // Process batch in parallel
      const promises = batch.map(({ memberData, registrationId, snapshotRef }) =>
        enrollMemberInDevice(memberData, registrationId, snapshotRef).catch(err => {
          const errorMsg = err?.message || err?.toString() || "Unknown error occurred";
          log("error", `Failed to process enrollment for ${memberData.name}:`, errorMsg);
        })
      );

      await Promise.all(promises);

      // Small delay between batches to avoid overwhelming the device
      if (enrollmentQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally {
    isProcessingQueue = false;

    // If more items added while processing, schedule next run
    if (enrollmentQueue.length > 0) {
      setImmediate(() => processEnrollmentQueue());
    }
  }
}

/**
 * Add enrollment to queue
 */
function queueEnrollment(memberData, registrationId, snapshotRef) {
  enrollmentQueue.push({ memberData, registrationId, snapshotRef });

  log("info", `📥 Added ${memberData.name} to enrollment queue (position: ${enrollmentQueue.length})`);

  // Trigger processing
  processEnrollmentQueue();
}

/**
 * Initialize the member enrollment listener
 * @param {object} deviceSvc - The device service instance to use for enrollment
 */
function initializeMemberEnrollmentListener(deviceSvc) {
  deviceService = deviceSvc;

  const registrationsRef = realtimeDb.ref("member_registrations");
  let isInitialLoad = true;
  let enrolledCount = 0;
  let newMembersCount = 0;

  log("info", "🎧 Starting Firebase Realtime Database listener for member registrations...");

  // Listen for new member registrations
  registrationsRef.on("child_added", async (snapshot) => {
    const memberData = snapshot.val();
    const registrationId = snapshot.key;

    // Skip if already enrolled
    if (memberData.esslEnrolled === true) {
      // Only count during initial load, don't log each one
      if (isInitialLoad) {
        enrolledCount++;
      }
      return;
    }

    // New member that needs enrollment
    if (isInitialLoad) {
      newMembersCount++;
    } else {
      // Only log for actual new registrations after initial load
      log("info", `📝 New member registration detected: ${memberData.name} (ID: ${memberData.biometricDeviceId})`);
    }

    // Add to queue instead of processing immediately
    queueEnrollment(memberData, registrationId, snapshot.ref);
  });

  // Once initial data is loaded, show summary
  registrationsRef.once("value", () => {
    isInitialLoad = false;
    const totalMembers = enrolledCount + newMembersCount;

    if (totalMembers > 0) {
      log("success", `✅ Member enrollment listener active! (${enrolledCount} already enrolled, ${newMembersCount} pending enrollment)`);
    } else {
      log("success", "✅ Member enrollment listener active! No members found.");
    }
  });
}

/**
 * Enroll a member in the ESSL biometric device
 * @param {object} memberData - Member data from Realtime Database
 * @param {string} registrationId - The registration ID
 * @param {object} snapshotRef - Reference to update status
 */
async function enrollMemberInDevice(memberData, registrationId, snapshotRef) {
  const zkInstance = deviceService.getZkInstance();

  // Check if device is connected
  if (!deviceService.isConnected() || !zkInstance) {
    log("warning", `Cannot enroll ${memberData.name} - ESSL device not connected`);

    // Update status in Firebase
    await snapshotRef.update({
      esslEnrolled: false,
      esslStatus: "failed",
      esslError: "Device not connected",
      esslAttemptedAt: new Date().toISOString(),
    });

    return;
  }

  try {
    log("info", `🔄 Enrolling ${memberData.name} in ESSL device...`);

    // Enroll user in the biometric device
    // Parameters: uid, userid, name, password, role, cardno
    await zkInstance.setUser(
      parseInt(memberData.biometricDeviceId), // uid - unique user ID (number)
      memberData.biometricDeviceId.toString(), // userid - user ID as string
      memberData.name || "", // name - user's name
      "", // password - optional password
      0, // role - 0=user, 14=admin
      0 // cardno - card number if using RFID
    );

    log("success", `✅ Successfully enrolled ${memberData.name} in ESSL device!`);

    // Update status in Firebase
    await snapshotRef.update({
      esslEnrolled: true,
      esslEnrolledAt: new Date().toISOString(),
      esslStatus: "success",
    });

    log("success", `✅ Updated enrollment status in Firebase for ${memberData.name}`);
  } catch (error) {
    const errorMsg = error?.message || error?.toString() || "Unknown error occurred";
    log("error", `❌ Failed to enroll ${memberData.name}:`, errorMsg);

    // Update with error status
    await snapshotRef.update({
      esslEnrolled: false,
      esslStatus: "failed",
      esslError: errorMsg,
      esslAttemptedAt: new Date().toISOString(),
    });
  }
}

/**
 * Get enrollment queue statistics
 */
function getEnrollmentQueueStats() {
  return {
    queueLength: enrollmentQueue.length,
    isProcessing: isProcessingQueue,
    maxConcurrent: MAX_CONCURRENT_ENROLLMENTS,
  };
}

/**
 * Clear enrollment queue (for testing or emergency)
 */
function clearEnrollmentQueue() {
  const count = enrollmentQueue.length;
  enrollmentQueue.length = 0;
  log("warning", `Enrollment queue cleared (${count} items removed)`);
}

module.exports = {
  initializeMemberEnrollmentListener,
  getEnrollmentQueueStats,
  clearEnrollmentQueue,
};
