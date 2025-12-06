# ZK Attendance Desktop App (Tauri Edition)

A strictly offline, local-first desktop application for managing ZKTeco biometric attendance devices. Built with **Tauri**, **Node.js**, **Express**, and **SQLite**.

## Features

-   **Real-time Attendance Monitoring**: View check-ins as they happen via Socket.IO.
-   **Hardware Integration**: Direct communication with ZKTeco devices (e.g., eSSL K30 Pro) over UDP/TCP.
-   **Offline First**: All data stored locally in SQLite (`better-sqlite3`).
-   **Firebase Sync**: Background synchronization with Firestore for cloud backups (optional).
-   **User Management**: Text-to-Speech welcome messages and membership expiry alerts.

## Prerequisites

-   **Node.js**: v18 or newer (v20+ recommended).
-   **Rust**: Required for building Tauri. Install via `rustup` (https://rustup.rs/).
-   **Build Tools**:
    -   **Windows**: Microsoft Visual Studio C++ Build Tools.
    -   **macOS**: Xcode Command Line Tools.
    -   **Linux**: `build-essential`, `libwebkit2gtk-4.0-dev`, `libappindicator3-dev`.

## Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd zk-attendance-desktop
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    # Enter the src-tauri directory and install Rust dependencies (happens automatically on build, but good to check)
    cd src-tauri
    cargo check
    cd ..
    ```

## Development

Run the application in development mode with hot-reloading:

```bash
npm run tauri dev
# OR directly:
npx tauri dev
```

**Note**: In development, the backend server is spawned efficiently using `std::process::Command` to avoid packaging overhead.

### Mock Mode (No Device)

To test the UI without a physical biometric device:
1.  Open `config/deviceConfig.js`.
2.  Set `useMockDevice: true`.
3.  Restart the app. It will simulate device connection and attendance events.

## Building for Production

Create an optimized, native executable installer:

```bash
npm run tauri build
# OR directly:
npx tauri build
```

The installer will be located in `src-tauri/target/release/bundle/msi` (Windows) or `dmg` (macOS).

## Architecture

-   **Frontend**: HTML/JS/CSS running in a Tauri webview.
-   **Backend**: A standalone Node.js Express server (`services/backend-server.js`) packaged as a **Sidecar**.
-   **Communication**:
    -   Frontend -> Backend: HTTP (REST API).
    -   Backend -> Frontend: Socket.IO (Real-time events).

## Troubleshooting

-   **"Failed to connect to backend"**: Ensure port `5001` is free. Check `src-tauri/src/main.rs` logs in the terminal.
-   **Device not found**:
    -   Verify the device IP in `config/deviceConfig.js`.
    -   Ensure the computer and device are on the same subnet.
    -   Disable firewall/antivirus temporarily to test UDP discovery.

## License

[ISC](LICENSE)