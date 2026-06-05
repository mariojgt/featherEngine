use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

/// Walk up from the current working directory to the engine folder (the dir with package.json).
fn find_engine_root() -> Result<PathBuf, String> {
  let mut dir = std::env::current_dir().map_err(|e| e.to_string())?;
  loop {
    if dir.join("package.json").exists() {
      return Ok(dir);
    }
    match dir.parent() {
      Some(parent) => dir = parent.to_path_buf(),
      None => return Err("Could not find the engine folder (package.json) to build from.".into()),
    }
  }
}

/// Run the production export pipeline (portable web folder + optional native app) for the
/// staged game bundle, streaming each output line to the frontend as a `production-build-progress`
/// event. Returns the bundle output directory on success.
#[tauri::command]
async fn run_production_build(
  app: AppHandle,
  bundle_json: String,
  native: bool,
  out_dir: Option<String>,
) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let root = find_engine_root()?;

    // Stage the bundle where the export script reads it by default.
    let staging = root.join("exports").join("staging");
    std::fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let bundle_path = staging.join("game.json");
    std::fs::write(&bundle_path, &bundle_json).map_err(|e| e.to_string())?;

    let script = if native { "export:production" } else { "export:web" };
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let _ = app.emit(
      "production-build-progress",
      format!("Starting {} build…", if native { "native + web" } else { "web" }),
    );

    // npm run <script> -- --bundle <path> [--out <dir>]
    let mut args: Vec<String> = vec![
      "run".into(),
      script.into(),
      "--".into(),
      "--bundle".into(),
      bundle_path.to_string_lossy().into_owned(),
    ];
    if let Some(out) = out_dir.as_deref() {
      args.push("--out".into());
      args.push(out.to_string());
    }

    let mut child = Command::new(npm)
      .args(&args)
      .current_dir(&root)
      .stdout(Stdio::piped())
      .stderr(Stdio::piped())
      .spawn()
      .map_err(|e| format!("Failed to start the build (is npm on your PATH?): {e}"))?;

    // Stream stdout and stderr lines to the frontend.
    let mut readers = Vec::new();
    if let Some(out) = child.stdout.take() {
      let handle = app.clone();
      readers.push(std::thread::spawn(move || {
        for line in BufReader::new(out).lines().map_while(Result::ok) {
          let _ = handle.emit("production-build-progress", line);
        }
      }));
    }
    if let Some(err) = child.stderr.take() {
      let handle = app.clone();
      readers.push(std::thread::spawn(move || {
        for line in BufReader::new(err).lines().map_while(Result::ok) {
          let _ = handle.emit("production-build-progress", line);
        }
      }));
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    for reader in readers {
      let _ = reader.join();
    }

    if status.success() {
      let dest = out_dir.unwrap_or_else(|| root.join("exports").to_string_lossy().into_owned());
      Ok(dest)
    } else {
      Err(format!("Build failed (exit {}). See the build log for details.", status))
    }
  })
  .await
  .map_err(|e| e.to_string())?
}

/// Open the OS file manager with the given file highlighted (Explorer on Windows, Finder on macOS,
/// the parent directory on Linux as a best-effort fallback since there's no portable "reveal"). The
/// path is validated as an existing file before we hand it to the shell so we never spawn a process
/// with attacker-controlled arguments. Returns a short error string on failure rather than panicking.
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
  let p = std::path::PathBuf::from(&path);
  if !p.exists() {
    return Err(format!("File no longer exists: {path}"));
  }

  #[cfg(target_os = "windows")]
  {
    Command::new("explorer")
      .arg(format!("/select,{}", p.display()))
      .spawn()
      .map_err(|e| e.to_string())?;
    return Ok(());
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg("-R")
      .arg(&p)
      .spawn()
      .map_err(|e| e.to_string())?;
    return Ok(());
  }

  #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
  {
    let dir = p.parent().unwrap_or(&p);
    Command::new("xdg-open")
      .arg(dir)
      .spawn()
      .map_err(|e| e.to_string())?;
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![run_production_build, reveal_in_explorer])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
