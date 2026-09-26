use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex},
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager};

struct ManagedRealm {
    child: Child,
    status: Value,
}
#[derive(Default)]
pub struct TitanRealmManager {
    process: Mutex<Option<ManagedRealm>>,
}

fn stop(process: &mut Option<ManagedRealm>) {
    if let Some(mut realm) = process.take() {
        if let Some(mut input) = realm.child.stdin.take() {
            let _ = input.write_all(b"stop\n");
        }
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(realm.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = realm.child.kill();
        let _ = realm.child.wait();
    }
}
impl TitanRealmManager {
    pub fn shutdown_now(&self) {
        if let Ok(mut process) = self.process.lock() {
            stop(&mut process);
        }
    }
}

fn validate_api(value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Ok(());
    }
    let url = tauri::Url::parse(value).map_err(|_| "Enter a valid Titan API URL")?;
    let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
    if (url.scheme() != "https" && !(local && url.scheme() == "http"))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("Use an HTTPS Titan API URL, or localhost for development.".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn manage_titan_realm(
    app: AppHandle,
    action: String,
    game_id: Option<String>,
    settings: Option<Value>,
    origin: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = app.state::<TitanRealmManager>();
        let mut process = manager.process.lock().map_err(|_| "Realm manager unavailable")?;
        if let Some(realm) = process.as_mut() { if realm.child.try_wait().map_err(|e| e.to_string())?.is_some() { *process = None; } }
        if action == "status" { return Ok(process.as_ref().map(|p| p.status.clone()).unwrap_or(json!({"running":false}))); }
        if action == "stop" { stop(&mut process); return Ok(json!({"running":false})); }
        if action != "start" { return Err("Unknown realm action".into()); }
        let id = game_id.ok_or("Open a game project first")?;
        if id.is_empty() || id.len() > 128 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c)) { return Err("Invalid game identity".into()); }
        let settings = settings.ok_or("Save your Titan settings first")?;
        let api = settings["baseUrl"].as_str().unwrap_or("").trim();
        let key = settings["gameKey"].as_str().unwrap_or("").trim();
        validate_api(api)?;
        if api.is_empty() != key.is_empty() { return Err("Enter both Titan API URL and game key, or choose demo accounts.".into()); }
        if key.len() > 512 || ["sb_secret_", "service_role", "eyj"].iter().any(|prefix| key.to_lowercase().starts_with(prefix)) { return Err("Use the Titan project game key.".into()); }
        let mut origins = vec!["tauri://localhost".to_string(), "http://tauri.localhost".into(), "https://tauri.localhost".into()];
        if let Some(value) = origin {
            if let Ok(url) = tauri::Url::parse(&value) {
                if matches!(url.host_str(), Some("localhost" | "127.0.0.1")) && url.scheme() == "http" { origins.push(value); }
            }
        }
        let root = crate::production_runtime::runtime_root(&app)?.join("titan-local");
        let manifest: Value = serde_json::from_slice(&fs::read(root.join("manifest.json")).map_err(|_| "The local realm runtime is missing. Install the current Feather desktop build.")?).map_err(|e| e.to_string())?;
        let name = if cfg!(windows) { "feather-realm.exe" } else { "feather-realm" };
        if manifest["version"] != 1 || manifest["executable"] != name { return Err("Invalid local realm runtime.".into()); }
        let executable = root.join(name);
        let digest = format!("{:x}", Sha256::digest(fs::read(&executable).map_err(|e| e.to_string())?));
        if manifest["sha256"] != digest { return Err("The local realm runtime failed verification. Reinstall Feather.".into()); }
        let namespace = format!("{:x}", Sha256::digest(format!("{id}:{api}:{key}")));
        let data = app.path().app_data_dir().map_err(|e| e.to_string())?.join("titan-realms").join(&namespace[..24]);
        fs::create_dir_all(&data).map_err(|e| e.to_string())?;
        let config = data.join("realm-config.json");
        fs::write(&config, serde_json::to_vec(&json!({"version":1,"gameId":id,"storageId":&namespace[..24],"titanUrl":api,"gameKey":key,"origins":origins.join(","),"dataFile":data.join("players.json")})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        #[cfg(unix)] { use std::os::unix::fs::PermissionsExt; fs::set_permissions(&config, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?; }
        stop(&mut process);
        let mut command = Command::new(&executable);
        command.args(["--local", "--config"]).arg(&config).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.spawn().map_err(|e| format!("Could not start local realm: {e}"))?;
        let stdout = child.stdout.take().ok_or("Realm did not expose readiness")?;
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || { let mut line = String::new(); let _ = BufReader::new(stdout).read_line(&mut line); let _ = send.send(line); });
        let ready = receive.recv_timeout(Duration::from_secs(10)).ok().and_then(|line| serde_json::from_str::<Value>(&line).ok());
        if let Some(status) = ready.filter(|status| status["type"] == "ready" && status["gameId"] == id && status["running"] == true) {
            *process = Some(ManagedRealm { child, status: status.clone() }); Ok(status)
        } else { let _ = child.kill(); let _ = child.wait(); Err("The local realm could not start. Check your Titan settings and try again.".into()) }
    }).await.map_err(|e| e.to_string())?
}
