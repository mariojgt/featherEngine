use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeManifest {
    version: u32,
    source_hash: String,
    features: Vec<String>,
    files: Vec<RuntimeFile>,
    runners: Vec<Runner>,
}
#[derive(Clone, Deserialize, Serialize, Debug)]
struct RuntimeFile {
    path: String,
    sha256: String,
}
#[derive(Clone, Deserialize)]
struct Runner {
    target: String,
    architecture: String,
    path: String,
    sha256: String,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductionArtifact {
    pub target: String,
    pub directory: String,
    pub depot_root: String,
    pub executable: Option<String>,
    pub launch_test: String,
    files: Vec<RuntimeFile>,
}
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProductionReport {
    pub format_version: u32,
    pub build_id: String,
    pub source_hash: String,
    pub profile: Value,
    pub artifacts: Vec<ProductionArtifact>,
    pub asset_reports: Value,
}

fn host() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn safe_relative(value: &str) -> bool {
    !value.is_empty()
        && !Path::new(value).is_absolute()
        && !value.contains(['\\', ':', '\0'])
        && value
            .split('/')
            .all(|part| !part.is_empty() && part != "." && part != "..")
}
fn checked_file(root: &Path, relative: &str, expected: &str) -> Result<PathBuf, String> {
    if !safe_relative(relative) {
        return Err("Invalid runtime file path".into());
    }
    let file = root
        .join(relative)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let base = root.canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(base) || !file.is_file() {
        return Err("Runtime file escapes its package".into());
    }
    if digest(&fs::read(&file).map_err(|e| e.to_string())?) != expected {
        return Err(format!("Runtime file was changed: {relative}"));
    }
    Ok(file)
}
fn inventory(root: &Path) -> Result<Vec<RuntimeFile>, String> {
    fn walk(root: &Path, directory: &Path, files: &mut Vec<RuntimeFile>) -> Result<(), String> {
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name() == ".DS_Store" {
                continue;
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            if kind.is_symlink() {
                return Err("Game artifacts cannot contain symbolic links.".into());
            }
            let path = entry.path();
            if kind.is_dir() {
                walk(root, &path, files)?;
            } else if kind.is_file() {
                files.push(RuntimeFile {
                    path: path
                        .strip_prefix(root)
                        .map_err(|e| e.to_string())?
                        .to_string_lossy()
                        .replace('\\', "/"),
                    sha256: digest(&fs::read(&path).map_err(|e| e.to_string())?),
                });
            }
        }
        Ok(())
    }
    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}
pub(crate) fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let packaged = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("export-runtime");
    if packaged.join("manifest.json").is_file() {
        return Ok(packaged);
    }
    // Development builds use the same prepared resources as the installed editor.
    let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("export-runtime");
    if development.join("manifest.json").is_file() {
        return Ok(development);
    }
    Err("This editor has no packaged export runtime. Install a current Feather desktop release, or run npm run prepare:runtime in the engine source.".into())
}
fn manifest(root: &Path) -> Result<RuntimeManifest, String> {
    let value: RuntimeManifest =
        serde_json::from_slice(&fs::read(root.join("manifest.json")).map_err(|e| e.to_string())?)
            .map_err(|e| format!("Invalid export runtime: {e}"))?;
    if value.version != 1 || value.files.is_empty() {
        return Err("Unsupported or empty export runtime".into());
    }
    Ok(value)
}
fn all_runners(app: &AppHandle, runtime: &Path, data: &RuntimeManifest) -> Vec<(Runner, PathBuf)> {
    let mut runners: Vec<_> = data
        .runners
        .iter()
        .cloned()
        .map(|r| (r, runtime.to_path_buf()))
        .collect();
    if let Ok(dir) = app.path().app_data_dir() {
        if let Ok(entries) = fs::read_dir(dir.join("runner-packs")) {
            for entry in entries.flatten() {
                let root = entry.path();
                if let Ok(raw) = fs::read(root.join("runner.json")) {
                    if let Ok(value) = serde_json::from_slice::<Value>(&raw) {
                        if value["version"] == 1 {
                            if let (Some(target), Some(architecture), Some(path), Some(sha256)) = (
                                value["target"].as_str(),
                                value["architecture"].as_str(),
                                value["executable"].as_str(),
                                value["sha256"].as_str(),
                            ) {
                                runners.push((
                                    Runner {
                                        target: target.into(),
                                        architecture: architecture.into(),
                                        path: path.into(),
                                        sha256: sha256.into(),
                                    },
                                    root,
                                ));
                            }
                        }
                    }
                }
            }
        }
    }
    runners
}
fn choose_runner<'a>(
    runners: &'a [(Runner, PathBuf)],
    target: &str,
) -> Option<&'a (Runner, PathBuf)> {
    runners
        .iter()
        .find(|(r, _)| r.target == target && r.architecture == std::env::consts::ARCH)
}

pub(crate) fn platform_report(app: &AppHandle) -> Result<String, String> {
    let root = runtime_root(app)?;
    let data = manifest(&root)?;
    let runners = all_runners(app, &root, &data);
    let platforms: Vec<_> = ["web", "windows", "macos", "linux", "android", "ios"].into_iter().map(|target| {
        let runner = choose_runner(&runners, target);
        let ready = target == "web" || runner.is_some_and(|(r, root)| checked_file(root, &r.path, &r.sha256).is_ok()) && (target != "macos" || cfg!(target_os = "macos"));
        json!({ "id": target, "label": target, "kind": if target == "web" { "web" } else if target == "ios" || target == "android" { "mobile" } else { "desktop" }, "status": if ready { "ready" } else { "missing" },
            "requirements": [{ "id": "runtime", "label": "Game runtime", "ok": ready, "fix": if target == "ios" || target == "android" { "Use the source/CI mobile exporter with the platform SDK and signing tools." } else if target == "macos" && !cfg!(target_os = "macos") { "Build on macOS to sign the app." } else { "Install a Feather runner pack matching this editor CPU architecture in the build dialog." } }],
            "notes": if ready { "Packages directly from the installed editor. No compiler required. Native targets use the system WebView." } else { "An additional platform runtime or build host is needed." } })
    }).collect();
    Ok(
        json!({ "host": host(), "hostLabel": "Installed game runtimes", "platforms": platforms })
            .to_string(),
    )
}

#[tauri::command]
pub(crate) fn install_runner_pack(app: AppHandle, directory: String) -> Result<String, String> {
    let root = PathBuf::from(directory);
    let raw = fs::read(root.join("runner.json")).map_err(|e| e.to_string())?;
    let value: Value = serde_json::from_slice(&raw).map_err(|e| e.to_string())?;
    let target = value["target"].as_str().ok_or("Missing runner target")?;
    let arch = value["architecture"]
        .as_str()
        .ok_or("Missing runner architecture")?;
    if value["version"] != 1
        || !["windows", "macos", "linux"].contains(&target)
        || !["aarch64", "x86_64"].contains(&arch)
    {
        return Err("Unsupported runner pack".into());
    }
    let executable = value["executable"]
        .as_str()
        .ok_or("Missing runner executable")?;
    let source = checked_file(
        &root,
        executable,
        value["sha256"].as_str().ok_or("Missing runner checksum")?,
    )?;
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("runner-packs")
        .join(format!("{target}-{arch}"));
    fs::create_dir_all(
        dest.join(executable)
            .parent()
            .ok_or("Invalid runner path")?,
    )
    .map_err(|e| e.to_string())?;
    fs::copy(source, dest.join(executable)).map_err(|e| e.to_string())?;
    fs::write(dest.join("runner.json"), raw).map_err(|e| e.to_string())?;
    Ok(format!("Installed {target} ({arch}) game runtime."))
}

fn copy_player(root: &Path, data: &RuntimeManifest, dest: &Path) -> Result<(), String> {
    for file in &data.files {
        let source = checked_file(&root.join("player"), &file.path, &file.sha256)?;
        let target = dest.join(&file.path);
        fs::create_dir_all(target.parent().ok_or("Invalid player path")?)
            .map_err(|e| e.to_string())?;
        fs::copy(source, target).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn write_bundle(mut bundle: Value, game: &Path, runtime: &RuntimeManifest) -> Result<(), String> {
    for feature in bundle["runtimeContract"]["requiredFeatures"]
        .as_array()
        .ok_or("Missing runtime contract")?
    {
        if !runtime
            .features
            .iter()
            .any(|f| Some(f.as_str()) == feature.as_str())
        {
            return Err(format!(
                "The installed player does not support {feature}. Update the editor."
            ));
        }
    }
    let stream = bundle["buildProfile"]["optimization"]["streamAssets"]
        .as_bool()
        .unwrap_or(true);
    if stream
        && !runtime
            .features
            .iter()
            .any(|feature| feature == "streamed-assets")
    {
        return Err(
            "The installed player does not support streamed assets. Update the editor.".into(),
        );
    }
    let assets = bundle["project"]["assets"]
        .as_array_mut()
        .ok_or("Missing game assets")?;
    for asset in assets {
        let data = asset["data"]
            .as_str()
            .ok_or("An exported asset has no embedded bytes")?;
        let (header, encoded) = data.split_once(',').ok_or("Invalid asset data")?;
        if !header.starts_with("data:") || !header.ends_with(";base64") {
            return Err("Invalid asset encoding".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .map_err(|e| e.to_string())?;
        if stream {
            let hash = digest(&bytes);
            let ext = asset["name"]
                .as_str()
                .and_then(|n| n.rsplit('.').next())
                .filter(|e| {
                    e.len() <= 8 && !e.is_empty() && e.bytes().all(|c| c.is_ascii_alphanumeric())
                })
                .unwrap_or("bin")
                .to_lowercase();
            let path = format!("game-assets/{hash}.{ext}");
            fs::create_dir_all(game.join("game-assets")).map_err(|e| e.to_string())?;
            fs::write(game.join(&path), &bytes).map_err(|e| e.to_string())?;
            let object = asset.as_object_mut().ok_or("Invalid game asset")?;
            object.remove("data");
            object.remove("url");
            object.insert(
                "delivery".into(),
                json!({ "path": path, "sha256": hash, "bytes": bytes.len() }),
            );
        }
    }
    if stream {
        let features = bundle["runtimeContract"]["requiredFeatures"]
            .as_array_mut()
            .unwrap();
        if !features.iter().any(|f| f == "streamed-assets") {
            features.push(json!("streamed-assets"));
        }
    }
    fs::write(
        game.join("game.json"),
        serde_json::to_vec(&bundle).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub(crate) fn build(
    app: &AppHandle,
    variants: HashMap<String, String>,
    profile_json: String,
    targets: Vec<String>,
    out_dir: String,
    asset_reports: Value,
) -> Result<String, String> {
    let runtime = runtime_root(app)?;
    let data = manifest(&runtime)?;
    let runners = all_runners(app, &runtime, &data);
    build_from_runtime(
        &runtime,
        data,
        runners,
        variants,
        profile_json,
        targets,
        out_dir,
        asset_reports,
        |line| {
            let _ = app.emit("production-build-progress", line);
        },
    )
}

fn build_from_runtime(
    runtime: &Path,
    data: RuntimeManifest,
    runners: Vec<(Runner, PathBuf)>,
    variants: HashMap<String, String>,
    profile_json: String,
    targets: Vec<String>,
    out_dir: String,
    asset_reports: Value,
    progress: impl Fn(String),
) -> Result<String, String> {
    if targets.is_empty()
        || targets
            .iter()
            .any(|target| !["web", "windows", "macos", "linux"].contains(&target.as_str()))
    {
        return Err("Choose a supported desktop or web build target.".into());
    }
    let profile: Value = serde_json::from_str(&profile_json).map_err(|e| e.to_string())?;
    let name = profile["application"]["productName"]
        .as_str()
        .ok_or("Missing game name")?;
    if name.is_empty() || name.contains(['/', '\\', '\0', '\n', '\r']) {
        return Err("Invalid game name".into());
    }
    let id = profile["application"]["identifier"]
        .as_str()
        .ok_or("Missing game identity")?;
    let slug: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let build_id = uuid::Uuid::new_v4().simple().to_string();
    let out = PathBuf::from(out_dir).join(format!("{slug}-{}", &build_id[..8]));
    fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let mut artifacts = Vec::new();
    let result = (|| {
        for target in targets {
            let raw = variants
                .get(&target)
                .ok_or_else(|| format!("No prepared {target} bundle"))?;
            let bundle: Value = serde_json::from_str(raw).map_err(|e| e.to_string())?;
            if bundle["buildProfile"] != profile
                || bundle["startSceneId"] != profile["startSceneId"]
            {
                return Err("Prepared bundle does not match the reviewed build profile".into());
            }
            let dest = out.join(format!("{slug}-{target}"));
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            progress(format!("Packaging {target}…"));
            let (game, executable) = if target == "web" {
                (dest.clone(), None)
            } else {
                if !["windows", "macos", "linux"].contains(&target.as_str()) {
                    return Err(format!(
                        "{target} requires the source/CI exporter and its platform SDK."
                    ));
                }
                let (runner, source_root) = choose_runner(&runners, &target)
                    .ok_or_else(|| format!("Install a {target} runner pack first."))?;
                let source = checked_file(source_root, &runner.path, &runner.sha256)?;
                let (game, exe) = if target == "macos" {
                    if !cfg!(target_os = "macos") {
                        return Err("Build macOS apps on macOS to sign them.".into());
                    }
                    let app_dir = dest.join(format!("{name}.app"));
                    fs::create_dir_all(app_dir.join("Contents/MacOS"))
                        .map_err(|e| e.to_string())?;
                    fs::write(app_dir.join("Contents/Info.plist"), format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict><key>CFBundleExecutable</key><string>feather-game</string><key>CFBundleIdentifier</key><string>{}</string><key>CFBundleName</key><string>{}</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>{}</string><key>CFBundleVersion</key><string>{}</string><key>NSHighResolutionCapable</key><true/></dict></plist>", xml(id), xml(name), xml(profile["application"]["version"].as_str().unwrap_or("0.1.0")), profile["application"]["buildNumber"])).map_err(|e| e.to_string())?;
                    (
                        app_dir.join("Contents/Resources/game"),
                        app_dir.join("Contents/MacOS/feather-game"),
                    )
                } else {
                    (
                        dest.join("game"),
                        dest.join(if target == "windows" {
                            format!("{slug}.exe")
                        } else {
                            slug.clone()
                        }),
                    )
                };
                fs::create_dir_all(&game).map_err(|e| e.to_string())?;
                fs::copy(source, &exe).map_err(|e| e.to_string())?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    fs::set_permissions(&exe, fs::Permissions::from_mode(0o755))
                        .map_err(|e| e.to_string())?;
                }
                (game, Some(exe))
            };
            copy_player(&runtime, &data, &game)?;
            write_bundle(bundle, &game, &data)?;
            if target == "macos" {
                let status = Command::new("/usr/bin/codesign")
                    .args(["--force", "--deep", "--sign", "-"])
                    .arg(dest.join(format!("{name}.app")))
                    .status()
                    .map_err(|e| e.to_string())?;
                if !status.success() {
                    return Err("macOS app signing failed.".into());
                }
            }
            let artifact = ProductionArtifact {
                target: target.clone(),
                directory: dest.to_string_lossy().into(),
                depot_root: dest.to_string_lossy().into(),
                executable: executable.map(|p| p.to_string_lossy().into()),
                launch_test: "not-run".into(),
                files: inventory(&dest)?,
            };
            artifacts.push(artifact);
        }
        let report = ProductionReport {
            format_version: 1,
            build_id,
            source_hash: data.source_hash,
            profile: profile.clone(),
            artifacts,
            asset_reports,
        };
        fs::write(
            out.join("build-report.json"),
            serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(out.to_string_lossy().into_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&out);
    }
    result
}

#[tauri::command]
pub(crate) fn inspect_production_build(directory: String) -> Result<ProductionReport, String> {
    let report: ProductionReport = serde_json::from_slice(
        &fs::read(Path::new(&directory).join("build-report.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if report.format_version != 1 {
        return Err(
            "This build predates connected publishing. Rebuild it with the current editor.".into(),
        );
    }
    let root = PathBuf::from(directory)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    for artifact in &report.artifacts {
        let directory = PathBuf::from(&artifact.directory)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        if !directory.starts_with(&root) || artifact.depot_root != artifact.directory {
            return Err("The artifact directory does not belong to this build.".into());
        }
        let current = inventory(&directory)?;
        if current.len() != artifact.files.len()
            || current
                .iter()
                .zip(&artifact.files)
                .any(|(a, b)| a.path != b.path || a.sha256 != b.sha256)
        {
            return Err(format!(
                "{} game files changed after packaging. Rebuild before publishing.",
                artifact.target
            ));
        }
    }
    Ok(report)
}

#[tauri::command]
pub(crate) async fn test_production_build(
    app: AppHandle,
    directory: String,
) -> Result<ProductionReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut report = inspect_production_build(directory.clone())?;
        let root = PathBuf::from(&directory)
            .canonicalize()
            .map_err(|e| e.to_string())?;
        for artifact in &mut report.artifacts {
            if artifact.target != host() {
                continue;
            }
            let exe = PathBuf::from(
                artifact
                    .executable
                    .as_ref()
                    .ok_or("Missing game executable")?,
            )
            .canonicalize()
            .map_err(|e| e.to_string())?;
            if !exe.starts_with(&root) {
                return Err("Game executable is outside this build".into());
            }
            let _ = app.emit(
                "production-build-progress",
                format!("Launching {} to check the start scene…", artifact.target),
            );
            let mut child = Command::new(exe)
                .arg("--smoke-test")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .map_err(|e| e.to_string())?;
            let started = std::time::Instant::now();
            while child.try_wait().map_err(|e| e.to_string())?.is_none() {
                if started.elapsed().as_secs() >= 75 {
                    let _ = child.kill();
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            let result = child.wait_with_output().map_err(|e| e.to_string())?;
            artifact.launch_test = if result.status.success()
                && String::from_utf8_lossy(&result.stdout)
                    .contains("Player loaded and rendered the launch scene.")
            {
                "passed"
            } else {
                "failed"
            }
            .into();
        }
        fs::write(
            root.join("build-report.json"),
            serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(report)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct TestDir(PathBuf);
    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("feather-package-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn never_substitutes_a_different_cpu_runner() {
        let opposite = if std::env::consts::ARCH == "aarch64" {
            "x86_64"
        } else {
            "aarch64"
        };
        let mut runners = vec![(
            Runner {
                target: "macos".into(),
                architecture: opposite.into(),
                path: "game".into(),
                sha256: "hash".into(),
            },
            PathBuf::from("pack"),
        )];
        assert!(choose_runner(&runners, "macos").is_none());
        runners.push((
            Runner {
                target: "macos".into(),
                architecture: std::env::consts::ARCH.into(),
                path: "game".into(),
                sha256: "hash".into(),
            },
            PathBuf::from("pack"),
        ));
        assert_eq!(
            choose_runner(&runners, "macos").unwrap().0.architecture,
            std::env::consts::ARCH
        );
    }

    #[test]
    fn packages_without_a_source_checkout_and_rejects_changed_artifacts() {
        let dir = TestDir::new();
        let runtime = dir.0.join("runtime");
        fs::create_dir_all(runtime.join("player/assets")).unwrap();
        fs::write(runtime.join("player/index.html"), b"<html>player</html>").unwrap();
        fs::write(
            runtime.join("player/assets/player.js"),
            b"console.log('player')",
        )
        .unwrap();
        let data = RuntimeManifest {
            version: 1,
            source_hash: "engine-revision".into(),
            features: vec!["streamed-assets".into()],
            files: inventory(&runtime.join("player")).unwrap(),
            runners: vec![],
        };
        let profile = json!({"startSceneId":"start", "application":{"productName":"Test Game", "identifier":"games.test.demo", "version":"1.0.0", "buildNumber":1}});
        let bundle = json!({"buildProfile":profile,"startSceneId":"start","runtimeContract":{"requiredFeatures":[]},"project":{"assets":[{"id":"badge","name":"badge.svg","data":"data:image/svg+xml;base64,PHN2Zy8+"}]}});
        let out_dir = dir.0.join("exports").to_string_lossy().into_owned();
        let package = |bundle: &Value, data: RuntimeManifest| {
            build_from_runtime(
                &runtime,
                data,
                vec![],
                HashMap::from([("web".into(), bundle.to_string())]),
                profile.to_string(),
                vec!["web".into()],
                out_dir.clone(),
                json!({}),
                |_| {},
            )
        };
        let out = package(&bundle, data.clone()).unwrap();
        let second = package(&bundle, data.clone()).unwrap();
        assert_ne!(out, second);
        let report = inspect_production_build(out.clone()).unwrap();
        let game = Path::new(&report.artifacts[0].depot_root);
        let shipped: Value =
            serde_json::from_slice(&fs::read(game.join("game.json")).unwrap()).unwrap();
        assert!(shipped["project"]["assets"][0]["data"].is_null());
        let asset = &shipped["project"]["assets"][0]["delivery"];
        assert_eq!(
            fs::read(game.join(asset["path"].as_str().unwrap())).unwrap(),
            b"<svg/>"
        );
        assert_eq!(
            shipped["runtimeContract"]["requiredFeatures"],
            json!(["streamed-assets"])
        );
        fs::write(game.join("assets/player.js"), b"changed").unwrap();
        assert!(inspect_production_build(out)
            .unwrap_err()
            .contains("changed after packaging"));
        let mut mismatched = bundle.clone();
        mismatched["buildProfile"]["application"]["productName"] = json!("Different");
        assert!(package(&mismatched, data.clone())
            .unwrap_err()
            .contains("reviewed build profile"));
        fs::write(runtime.join("player/index.html"), b"changed runtime").unwrap();
        assert!(package(&bundle, data)
            .unwrap_err()
            .contains("Runtime file was changed"));
        assert_eq!(
            fs::read_dir(&out_dir).unwrap().count(),
            2,
            "failed builds remove their partial output"
        );
    }

    #[test]
    fn rejects_unsafe_package_paths() {
        for path in [
            "../game",
            "/game",
            "x/../game",
            "C:/game",
            "x\\game",
            "x//game",
        ] {
            assert!(!safe_relative(path));
        }
        assert!(safe_relative("assets/game.wasm"));
    }
}
