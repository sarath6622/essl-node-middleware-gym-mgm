const admin = require("firebase-admin");
const log = require("../utils/logger");
const path = require("path");

let db = null;
let realtimeDb = null;

try {
  // Try to find serviceAccountKey.json in different locations
  let serviceAccount;
  
  try {
    // Try relative path first (development)
    serviceAccount = require("./serviceAccountKey.json");
  } catch (e) {
    // Try in app resources (production build)
    const resourcePath = path.join(process.resourcesPath || __dirname, "config", "serviceAccountKey.json");
    serviceAccount = require(resourcePath);
  }

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
