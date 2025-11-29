const { Server } = require("socket.io");
const log = require("../utils/logger");
const DEVICE_CONFIG = require("../config/deviceConfig");
const { isConnected } = require("./deviceService");

function initializeSocket(server) {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    log("info", `Web client connected: ${socket.id}`);

    // Auto-join clients to rooms for targeted broadcasts
    // This improves performance by avoiding broadcast to all clients
    socket.join("attendance"); // For attendance events
    socket.join("stats"); // For statistics updates

    log("debug", `Client ${socket.id} joined rooms: attendance, stats`);

    socket.emit("device_status", {
      connected: isConnected(),
      deviceIp: DEVICE_CONFIG.ip,
      timestamp: new Date().toISOString(),
    });

    socket.on("disconnect", () => {
      log("info", `Web client disconnected: ${socket.id}`);
    });
  });

  return io;
}

module.exports = initializeSocket;
