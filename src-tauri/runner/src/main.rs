#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

fn game_directory() -> Result<PathBuf, String> {
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let parent = executable.parent().ok_or("Missing executable directory")?;
    let root = if cfg!(target_os = "macos") && parent.file_name().is_some_and(|n| n == "MacOS") {
        parent
            .parent()
            .ok_or("Missing app resources")?
            .join("Resources/game")
    } else {
        parent.join("game")
    };
    root.canonicalize()
        .map_err(|_| "The game folder is missing beside this application.".into())
}

fn mime(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()).unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css",
        "json" => "application/json",
        "wasm" => "application/wasm",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ktx2" => "image/ktx2",
        "glb" => "model/gltf-binary",
        "gltf" => "model/gltf+json",
        "mp3" => "audio/mpeg",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        _ => "application/octet-stream",
    }
}

fn serve(root: &Path, request: &tauri::http::Request<Vec<u8>>) -> tauri::http::Response<Vec<u8>> {
    let fail = |status| {
        tauri::http::Response::builder()
            .status(status)
            .body(Vec::new())
            .unwrap()
    };
    if request.method() != "GET" && request.method() != "HEAD" {
        return fail(405);
    }
    let decoded = match percent_encoding::percent_decode_str(request.uri().path()).decode_utf8() {
        Ok(p) => p,
        Err(_) => return fail(400),
    };
    let relative = decoded.trim_start_matches('/');
    if relative
        .split('/')
        .any(|p| p == ".." || p == "." || p.contains('\\') || p.contains('\0'))
    {
        return fail(400);
    }
    let path = match root
        .join(if relative.is_empty() {
            "index.html"
        } else {
            relative
        })
        .canonicalize()
    {
        Ok(p) if p.starts_with(root) && p.is_file() => p,
        _ => return fail(404),
    };
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(_) => return fail(500),
    };
    let mut response = tauri::http::Response::builder()
        .header("Content-Type", mime(&path))
        .header("Accept-Ranges", "bytes");
    if matches!(
        path.extension().and_then(|ext| ext.to_str()),
        Some("html" | "json")
    ) {
        response = response.header("Cache-Control", "no-store");
    }
    let length = bytes.len();
    if let Some(range) = request
        .headers()
        .get("Range")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("bytes="))
    {
        let (start, end) = match range.split_once('-') {
            Some((a, b)) if !a.is_empty() => (
                a.parse::<usize>().ok(),
                if b.is_empty() {
                    Some(length.saturating_sub(1))
                } else {
                    b.parse::<usize>().ok()
                },
            ),
            Some(("", b)) => match b.parse::<usize>() {
                Ok(suffix) if suffix > 0 && length > 0 => {
                    (Some(length.saturating_sub(suffix)), Some(length - 1))
                }
                _ => return fail(416),
            },
            _ => return fail(416),
        };
        match (start, end) {
            (Some(start), Some(end)) if start <= end && start < length => {
                let end = end.min(length - 1);
                response = response
                    .status(206)
                    .header("Content-Range", format!("bytes {start}-{end}/{length}"));
                return response
                    .header("Content-Length", end - start + 1)
                    .body(if request.method() == "HEAD" {
                        Vec::new()
                    } else {
                        bytes[start..=end].to_vec()
                    })
                    .unwrap();
            }
            _ => return fail(416),
        }
    }
    response
        .header("Content-Length", length)
        .body(if request.method() == "HEAD" {
            Vec::new()
        } else {
            bytes
        })
        .unwrap()
}

fn run() -> Result<(), String> {
    let root = game_directory()?;
    let bundle: serde_json::Value =
        serde_json::from_slice(&std::fs::read(root.join("game.json")).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let profile = bundle
        .get("buildProfile")
        .ok_or("Missing game build profile")?;
    let application = profile.get("application").ok_or("Missing game identity")?;
    let identifier = application["identifier"]
        .as_str()
        .ok_or("Missing game identifier")?
        .to_string();
    if identifier.len() > 200
        || !identifier.contains('.')
        || !identifier
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'.')
    {
        return Err("Invalid game identifier".into());
    }
    let window = profile["window"].clone();
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = identifier.clone();
    let smoke = std::env::args().any(|arg| arg == "--smoke-test");
    let ready = Arc::new(AtomicBool::new(false));
    let protocol_ready = ready.clone();
    tauri::Builder::default()
        .register_uri_scheme_protocol("feather", move |_context, request| {
            if smoke && request.uri().path() == "/__feather_launch_error" {
                if let Some(query) = request.uri().query() {
                    eprintln!("Player launch diagnostic: {}", percent_encoding::percent_decode_str(query).decode_utf8_lossy());
                }
                return tauri::http::Response::builder().status(204).body(Vec::new()).unwrap();
            }
            if request.uri().path() == "/__feather_ready" {
                protocol_ready.store(true, Ordering::Relaxed);
                return tauri::http::Response::builder()
                    .status(204)
                    .body(Vec::new())
                    .unwrap();
            }
            serve(&root, &request)
        })
        .setup(move |app| {
            let dimension = |key: &str, fallback: f64| {
                window[key]
                    .as_f64()
                    .filter(|v| v.is_finite() && *v >= 1.0 && *v <= 16384.0)
                    .unwrap_or(fallback)
            };
            let data =
                app.path()
                    .app_data_dir()?
                    .join(if smoke { "launch-test" } else { "webview" });
            std::fs::create_dir_all(&data)?;
            WebviewWindowBuilder::new(
                app,
                "game",
                WebviewUrl::CustomProtocol("feather://localhost/index.html".parse()?),
            )
            .title(window["title"].as_str().unwrap_or("Game"))
            .inner_size(dimension("width", 1280.0), dimension("height", 720.0))
            .min_inner_size(dimension("minWidth", 640.0), dimension("minHeight", 360.0))
            .resizable(window["resizable"].as_bool().unwrap_or(true))
            .fullscreen(!smoke && window["fullscreen"].as_bool().unwrap_or(false))
            .data_directory(data)
            // WKWebView ignores data_directory. Use a nonpersistent store for launch checks so
            // prior builds or another check cannot leave this run with stale scripts/game data.
            .incognito(smoke)
            .initialization_script(if smoke {
                r#"(() => {
                  const report = message => fetch('./__feather_launch_error?' + encodeURIComponent(String(message).slice(0, 1200))).catch(() => {});
                  addEventListener('error', event => report(event.message + ' at ' + event.filename + ':' + event.lineno));
                  addEventListener('unhandledrejection', event => report(event.reason?.stack || event.reason));
                  setTimeout(() => { if (!window.__FEATHER_PLAYER_READY__) report('Still loading: ' + (document.body?.innerText || '(empty page)')); }, 15000);
                })();"#
            } else { "" })
            .disable_drag_drop_handler()
            .build()?;
            if smoke {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let start = Instant::now();
                    while start.elapsed() < Duration::from_secs(60) {
                        if ready.load(Ordering::Relaxed) {
                            println!("Player loaded and rendered the launch scene.");
                            handle.exit(0);
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    eprintln!("Player did not finish loading the launch scene within 60 seconds.");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .run(context)
        .map_err(|e| e.to_string())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_traversal_and_serves_ranges() {
        let dir = std::env::temp_dir().join(format!("feather-runner-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("audio.mp3"), b"0123456789").unwrap();
        let root = dir.canonicalize().unwrap();
        let request = tauri::http::Request::builder()
            .uri("feather://localhost/audio.mp3")
            .header("Range", "bytes=2-5")
            .body(Vec::new())
            .unwrap();
        let response = serve(&root, &request);
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"2345");
        let request = tauri::http::Request::builder()
            .uri("feather://localhost/audio.mp3")
            .header("Range", "bytes=-3")
            .body(Vec::new())
            .unwrap();
        assert_eq!(serve(&root, &request).body(), b"789");
        let request = tauri::http::Request::builder()
            .method("HEAD")
            .uri("feather://localhost/audio.mp3")
            .body(Vec::new())
            .unwrap();
        let response = serve(&root, &request);
        assert!(response.body().is_empty());
        assert_eq!(response.headers()["Content-Length"], "10");
        let request = tauri::http::Request::builder()
            .uri("feather://localhost/%2e%2e/secret")
            .body(Vec::new())
            .unwrap();
        assert_eq!(serve(&root, &request).status(), 400);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
