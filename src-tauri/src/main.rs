#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use std::process::Command;
use tauri::api::process::Command as TauriCommand;

fn main() {
  tauri::Builder::default()
    .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                // In Development: Run directly with Node.js using std::process::Command
                // This gives us more control and better error reporting than Tauri's Command wrapper for this specific use case
                println!("🚀 Starting backend server with node...");
                
                // Print CWD for debugging
                if let Ok(cwd) = std::env::current_dir() {
                    println!("📂 Current working directory: {:?}", cwd);
                }

                let script_path = "../services/backend-server.js";
                
                // Check if script exists
                if std::path::Path::new(script_path).exists() {
                     println!("✅ Script found at {}", script_path);
                } else {
                     println!("⚠️ Script NOT found at {}. Trying absolute path resolution...", script_path);
                }
                
                let child = Command::new("node")
                    .arg(script_path)
                    .stdout(std::process::Stdio::inherit())
                    .stderr(std::process::Stdio::inherit())
                    .spawn();

                match child {
                    Ok(_) => println!("✅ Backend node process spawned successfully"),
                    Err(e) => println!("❌ Failed to spawn backend node process: {}", e),
                }
            }

            #[cfg(not(debug_assertions))]
            {
                // In Production: Run as packaged sidecar
                let _ = TauriCommand::new_sidecar("backend")
                    .expect("failed to setup sidecar")
                    .spawn()
                    .expect("Failed to spawn sidecar");
            }
            // tauri::async_runtime::spawn(async move { ... });
        Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
    println!("❌ App loop exited unexpectedly!");
}
