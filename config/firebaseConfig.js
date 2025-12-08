const admin = require("firebase-admin");
const log = require("../utils/logger");
const path = require("path");

let db = null;
let realtimeDb = null;

try {
  // Try to find serviceAccountKey.json in different locations
  // Try to find serviceAccountKey.json in different locations
  let serviceAccount;
  
  try {
    // 1. Try embedded (dev or pkg snapshot)
    serviceAccount = require("./serviceAccountKey.json");
    // log('info', '✅ Loaded embedded serviceAccountKey.json');
  } catch (e) {
    // 2. Try external file in resources (Production Tauri/Electron)
    const possiblePaths = [
        path.join(process.cwd(), 'resources', 'serviceAccountKey.json'), // Tauri default
        path.join(process.cwd(), 'resources', 'config', 'serviceAccountKey.json'), // Electron/Tauri nested
        path.join(process.cwd(), 'serviceAccountKey.json'), // Root fallback
    ];

    for (const p of possiblePaths) {
        try {
            serviceAccount = require(p);
            log('info', `✅ Loaded external credentials from: ${p}`);
            break;
        } catch (err) {
            // Continue
        }
    }
  }

  if (!serviceAccount) throw new Error("Could not find serviceAccountKey.json in any location.");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://studio-7778498060-d5b43-default-rtdb.firebaseio.com/",
  });

  db = admin.firestore();
  realtimeDb = admin.database();
  
  log("success", "🔥 Firebase Firestore connected successfully!");
  log("success", "🔥 Firebase Realtime Database connected successfully!");
} catch (error) {
  log(
    "warning",
    "⚠️ Firebase initialization failed. App will run without Firebase features.",
    { errorMessage: error.message }
  );
  log("warning", "To enable Firebase, ensure serviceAccountKey.json is properly configured.");
  // Don't exit - let app run without Firebase
}

module.exports = { db, realtimeDb };
