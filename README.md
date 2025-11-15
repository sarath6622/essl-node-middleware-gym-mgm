# **ZK Attendance Monitor**

A powerful middleware and desktop application for **ZKTeco fingerprint devices** with real-time attendance monitoring, auto-enrollment, and Firebase integration.

---

## 🌟 **Features**

* ✨ **Desktop Application** – Beautiful cross-platform Electron app
* 🔄 **Real-time Monitoring** – Live attendance events via Socket.IO
* 📡 **Auto-Discovery** – Automatically finds devices
* 🔥 **Firebase Integration** – Auto-enrollment from Firebase
* 📊 **Live Statistics** – Real-time updates
* 🎯 **Mock Mode** – No physical device needed
* 🌐 **REST API** – Complete API for integrations
* 👥 **User Management** – Add, delete, manage users
* 🔍 **Network Scanner** – Scan your local network for devices

---

## 🚀 **Quick Start**

### **Installation**

```bash
# Clone or download the repository
cd Middleware

# Install dependencies
npm install
```

---

## 🎛️ **Choose Your Mode**

### **Option 1: Desktop Application (Recommended)**

Run the Electron GUI application:

```bash
npm run electron
```

**Includes:**

* Modern dark UI
* Real-time event visualization
* System tray mode
* Built-in network scanner
* One-click device discovery

See **ELECTRON_APP.md** for complete documentation.

---

### **Option 2: Command-Line Interface**

Run as a traditional Node.js server:

```bash
npm start
```

**Features:**

* Headless mode
* Lightweight
* All API endpoints available

---

## 📦 **Building the Desktop App**

### Build for your OS

```bash
npm run build
```

### Build for specific platforms

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux

# All platforms
npm run dist
```

Output will be in the `dist/` folder.

---

## ⚙️ **Configuration**

Edit **config/deviceConfig.js**:

```javascript
const DEVICE_CONFIG = {
  useMockDevice: false,
  autoDiscoverDevice: true,

  ip: "192.168.1.15",
  port: 4370,

  timeout: 10000,
  inactivityTimeout: 4000,

  scanTimeout: 600,
  scanConcurrency: 120,

  timezone: "Asia/Kolkata"
};
```

---

## 🔌 **API Endpoints**

### **Device Management**

* `GET /health` – Health check
* `GET /status` – Connection status
* `GET /reconnect` – Reconnect to device
* `GET /device/info` – Device information
* `GET /device/scan` – Scan network for devices

### **Attendance**

* `GET /attendance/logs` – All attendance records
* `GET /test/latest` – Latest attendance record

### **Polling Control**

* `POST /polling/start` – Start polling
* `POST /polling/stop` – Stop polling

### **User Management**

* `GET /users` – List users
* `POST /users/add` – Add user
* `DELETE /users/:userId` – Delete user

---

## 📡 **Device Discovery**

### Automatically

Set `autoDiscoverDevice: true` to scan on startup.

### Manual (API)

```bash
curl http://localhost:5001/device/scan
```

### Manual (Desktop UI)

Click **Scan Network**.

See **DEVICE_DISCOVERY.md** for more details.

---

## 🎨 **Desktop App Interface**

### Includes:

* **Header** – Connection status
* **Device Panel** – Scan, reconnect
* **Live Events** – Real-time attendance
* **Statistics** – Counters and summaries
* **Configuration** – Live settings display

### **System Tray**

App minimizes to tray—right-click tray icon to fully quit.

---

## 🔥 **Firebase Integration**

Supports automatic user enrollment:

1. Add Firebase Admin SDK credentials
2. Configure `memberEnrollmentService.js`
3. Users added to Firebase are enrolled automatically

---

## 🧪 **Development Mode (Mock Device)**

Enable mock mode:

```javascript
useMockDevice: true
```

Mock mode generates:

* Fake attendance events every 3s
* Random user IDs
* Realistic timestamps

---

## 📁 **Project Structure**

```
Middleware/
├── config/
│   └── deviceConfig.js
├── electron/
│   ├── main.js
│   ├── preload.js
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
├── routes/
│   ├── api.js
│   └── userManagement.js
├── services/
│   ├── deviceService.js
│   ├── mockDeviceService.js
│   ├── socketService.js
│   └── memberEnrollmentService.js
├── utils/
│   ├── logger.js
│   ├── dateUtils.js
│   └── networkScanner.js
└── middleware.js
```

---

## 🐛 **Troubleshooting**

### **Device Not Found**

1. Check device power
2. Same network
3. Firewall not blocking port 4370
4. Router AP isolation disabled
5. Try manual scan

### **Desktop App Won't Start**

```bash
rm -rf node_modules package-lock.json
npm install
```

### **Connection Failed**

* Verify IP
* Disable auto-discover and try static IP
* Ensure device not used by another app

---

## 📚 **Documentation**

* **ELECTRON_APP.md**
* **DEVICE_DISCOVERY.md**

---

## 🔐 **Security**

* Context isolation
* No Node.js in renderer
* Secure IPC
* Strong CSP headers

---

## 🛠️ **Technology Stack**

* Electron
* Express.js
* Socket.IO
* zkteco-js
* Firebase Admin
* Node.js

---

## 📄 **License**

ISC

---

## 🤝 **Contributing**

Contributions are welcome! Submit issues and PRs.

---

## 💡 **Tips**

### Desktop App

* `Ctrl/Cmd + R` to reload
* `F12` to open DevTools
* Runs in system tray

### CLI Mode

* Default port: **5001**
* Use `PORT=` to change

### Network Performance

* 2–5 seconds for `/24` subnet
* Increase `scanConcurrency` for faster scans
* Lower `scanTimeout` for quicker scans

---

## 🎉 **Credits**

Built with ❤️ for ZKTeco K30 Pro and compatible devices.

---
