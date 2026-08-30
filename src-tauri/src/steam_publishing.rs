use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

const MAX_DESCRIPTION_CHARS: usize = 255;
const MAX_ACCOUNT_CHARS: usize = 64;
const MAX_BRANCH_CHARS: usize = 64;
const MAX_CONTENT_ENTRIES: usize = 1_000_000;
static STEAM_PUBLISH_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamToolReport {
    ready: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    steamcmd_path: Option<String>,
    errors: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamPublishRequest {
    sdk_path: String,
    content_root: String,
    account: String,
    app_id: u32,
    depot_id: u32,
    description: String,
    branch: Option<String>,
    preview: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum SteamPublishStatus {
    Previewed,
    Uploaded,
    LiveBeta,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SteamPublishResult {
    status: SteamPublishStatus,
    app_id: u32,
    depot_id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    build_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
}

struct PublishJobDir(PathBuf);

impl Drop for PublishJobDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct ProcessObservations {
    build_id: Option<String>,
    authentication_failed: bool,
    permission_failed: bool,
    build_failed: bool,
}

#[tauri::command]
pub(crate) fn check_steam_tools(sdk_path: String) -> SteamToolReport {
    match resolve_steamcmd(&sdk_path) {
        Ok(path) => SteamToolReport {
            ready: true,
            steamcmd_path: Some(path.to_string_lossy().into_owned()),
            errors: Vec::new(),
        },
        Err(errors) => SteamToolReport {
            ready: false,
            steamcmd_path: None,
            errors,
        },
    }
}

#[tauri::command]
pub(crate) async fn run_steam_publish(
    app: AppHandle,
    request: SteamPublishRequest,
) -> Result<SteamPublishResult, String> {
    let app_cache = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("Could not locate Feather's cache directory: {error}"))?;

    tauri::async_runtime::spawn_blocking(move || run_steam_publish_impl(app, request, app_cache))
        .await
        .map_err(|error| format!("Steam publishing stopped unexpectedly: {error}"))?
}

fn run_steam_publish_impl(
    app: AppHandle,
    request: SteamPublishRequest,
    app_cache: PathBuf,
) -> Result<SteamPublishResult, String> {
    let _publish_guard = STEAM_PUBLISH_LOCK
        .try_lock()
        .map_err(|_| "Another Steam publish job is already running.".to_string())?;
    let branch = validate_request(&request)?;
    let steamcmd = resolve_steamcmd(&request.sdk_path).map_err(|errors| errors.join(" "))?;
    let content_root = validate_content_root(&request.content_root)?;

    let cache_root = app_cache.join("steam-publishing");
    ensure_safe_directory(&cache_root)?;
    let canonical_cache = std::fs::canonicalize(&cache_root)
        .map_err(|error| format!("Could not open the Steam publishing cache: {error}"))?;
    if canonical_cache.starts_with(&content_root) || content_root.starts_with(&canonical_cache) {
        return Err(
      "Choose a narrower game content folder; it currently contains Feather's Steam publishing cache."
        .into(),
    );
    }

    let build_outputs = cache_root.join("build-output");
    ensure_safe_directory(&build_outputs)?;
    let build_output = build_outputs.join(format!("app-{}", request.app_id));
    ensure_safe_directory(&build_output)?;

    let jobs = cache_root.join("jobs");
    ensure_safe_directory(&jobs)?;
    let job_path = jobs.join(uuid::Uuid::new_v4().simple().to_string());
    std::fs::create_dir(&job_path)
        .map_err(|error| format!("Could not create an isolated Steam publishing job: {error}"))?;
    let job = PublishJobDir(job_path);

    let depot_vdf_path = job.0.join(format!("depot_{}.vdf", request.depot_id));
    let app_vdf_path = job.0.join(format!("app_{}.vdf", request.app_id));
    let depot_vdf = render_depot_vdf(request.depot_id, &content_root);
    let app_vdf = render_app_vdf(
        &request,
        branch.as_deref(),
        &content_root,
        &build_output,
        &depot_vdf_path,
    );
    write_new_file(&depot_vdf_path, depot_vdf.as_bytes())?;
    write_new_file(&app_vdf_path, app_vdf.as_bytes())?;

    let mode = if request.preview { "preview" } else { "upload" };
    let _ = app.emit(
        "steam-publish-progress",
        format!(
            "Starting Steam {mode} for App {} / Depot {}…",
            request.app_id, request.depot_id
        ),
    );

    let mut child = Command::new(&steamcmd)
        .arg("+login")
        .arg(&request.account)
        .arg("+run_app_build")
        .arg(&app_vdf_path)
        .arg("+quit")
        .current_dir(
            steamcmd
                .parent()
                .ok_or_else(|| "The selected SteamCMD path has no parent directory.".to_string())?,
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| match error.kind() {
            std::io::ErrorKind::PermissionDenied => {
                "SteamCMD could not be started. Check that it has executable permission."
                    .to_string()
            }
            _ => format!("SteamCMD could not be started: {error}"),
        })?;

    let observations = Arc::new(Mutex::new(ProcessObservations::default()));
    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(spawn_output_reader(
            stdout,
            app.clone(),
            request.account.clone(),
            observations.clone(),
        ));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(spawn_output_reader(
            stderr,
            app.clone(),
            request.account.clone(),
            observations.clone(),
        ));
    }

    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for SteamCMD to finish: {error}"))?;
    for reader in readers {
        let _ = reader.join();
    }

    let observations = observations
        .lock()
        .map_err(|_| "Could not read SteamCMD's final status.".to_string())?;
    if !status.success()
        || observations.build_failed
        || observations.authentication_failed
        || observations.permission_failed
    {
        if observations.authentication_failed {
            return Err(
        "SteamCMD could not authenticate this build account. Sign in to SteamCMD once with this account, complete Steam Guard, then try again."
          .into(),
      );
        }
        if observations.permission_failed {
            return Err(
        "Steam rejected the upload because this account cannot publish the selected app or depot. Check its Steamworks permissions and depot assignment."
          .into(),
      );
        }
        return Err(format!(
            "SteamCMD {mode} failed (exit {}). Review the Steam publish progress for details.",
            status
        ));
    }

    let result_status = if request.preview {
        SteamPublishStatus::Previewed
    } else if branch.is_some() {
        SteamPublishStatus::LiveBeta
    } else {
        SteamPublishStatus::Uploaded
    };
    let completion = match result_status {
        SteamPublishStatus::Previewed => "Steam preview completed successfully.",
        SteamPublishStatus::Uploaded => "Steam upload completed successfully.",
        SteamPublishStatus::LiveBeta => {
            "Steam upload completed and was assigned to the beta branch."
        }
    };
    let _ = app.emit("steam-publish-progress", completion);

    Ok(SteamPublishResult {
        status: result_status,
        app_id: request.app_id,
        depot_id: request.depot_id,
        build_id: observations.build_id.clone(),
        branch,
    })
}

fn validate_request(request: &SteamPublishRequest) -> Result<Option<String>, String> {
    validate_text("Steamworks SDK path", &request.sdk_path, 4096, false)?;
    validate_text("Game content path", &request.content_root, 4096, false)?;
    validate_text(
        "Build description",
        &request.description,
        MAX_DESCRIPTION_CHARS,
        false,
    )?;

    if request.description.trim() != request.description {
        return Err("Build description cannot start or end with whitespace.".into());
    }
    if request.app_id == 0 {
        return Err("Steam App ID must be greater than zero.".into());
    }
    if request.depot_id == 0 {
        return Err("Steam Depot ID must be greater than zero.".into());
    }
    validate_account(&request.account)?;

    match request.branch.as_deref() {
        None | Some("") => Ok(None),
        Some(branch) => validate_branch(branch).map(Some),
    }
}

fn validate_text(
    label: &str,
    value: &str,
    max_chars: usize,
    allow_empty: bool,
) -> Result<(), String> {
    if !allow_empty && value.is_empty() {
        return Err(format!("{label} is required."));
    }
    if value.chars().count() > max_chars {
        return Err(format!("{label} is too long."));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label} cannot contain control characters."));
    }
    if value.contains('"') {
        return Err(format!("{label} cannot contain double quotes."));
    }
    Ok(())
}

fn validate_account(account: &str) -> Result<(), String> {
    validate_text("Steam build account", account, MAX_ACCOUNT_CHARS, false)?;
    if account.eq_ignore_ascii_case("anonymous") {
        return Err(
            "Steam publishing requires a build account; anonymous login cannot upload.".into(),
        );
    }
    if !account.chars().all(|character| {
        character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.' | '@')
    }) {
        return Err(
            "Steam build account may only contain letters, numbers, dot, underscore, hyphen, or @."
                .into(),
        );
    }
    Ok(())
}

fn validate_branch(branch: &str) -> Result<String, String> {
    validate_text("Steam beta branch", branch, MAX_BRANCH_CHARS, false)?;
    if branch.trim() != branch {
        return Err("Steam beta branch cannot start or end with whitespace.".into());
    }
    if branch.eq_ignore_ascii_case("default") || branch.eq_ignore_ascii_case("public") {
        return Err(
      "Publishing directly to Steam's default/public branch is disabled. Choose a private beta branch or leave the branch empty to upload only."
        .into(),
    );
    }
    if !branch
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        return Err(
            "Steam beta branch may only contain letters, numbers, underscore, or hyphen.".into(),
        );
    }
    Ok(branch.to_string())
}

fn validate_content_root(raw_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw_path);
    let root_metadata = std::fs::symlink_metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            "The selected game content folder does not exist.".to_string()
        } else {
            format!("Could not inspect the game content folder: {error}")
        }
    })?;
    if root_metadata.file_type().is_symlink() {
        return Err("The game content folder cannot be a symbolic link.".into());
    }
    if !root_metadata.is_dir() {
        return Err("The selected game content path is not a folder.".into());
    }

    let canonical = std::fs::canonicalize(path)
        .map_err(|error| format!("Could not open the game content folder: {error}"))?;
    if canonical.parent().is_none() {
        return Err("A filesystem root cannot be used as Steam game content.".into());
    }
    validate_text(
        "Resolved game content path",
        &canonical.to_string_lossy(),
        4096,
        false,
    )?;

    let mut pending = vec![canonical.clone()];
    let mut files = 0usize;
    let mut entries = 0usize;
    while let Some(directory) = pending.pop() {
        let children = std::fs::read_dir(&directory)
            .map_err(|error| format!("Could not read the game content folder: {error}"))?;
        for child in children {
            let child = child.map_err(|error| format!("Could not read game content: {error}"))?;
            entries += 1;
            if entries > MAX_CONTENT_ENTRIES {
                return Err(
                    "The game content folder contains too many entries to validate safely.".into(),
                );
            }
            let file_type = child
                .file_type()
                .map_err(|error| format!("Could not inspect game content: {error}"))?;
            if file_type.is_symlink() {
                return Err(format!(
                    "Game content cannot contain symbolic links: {}",
                    child.path().display()
                ));
            }
            if file_type.is_dir() {
                pending.push(child.path());
            } else if file_type.is_file() {
                files += 1;
            } else {
                return Err(format!(
                    "Game content contains an unsupported special file: {}",
                    child.path().display()
                ));
            }
        }
    }
    if files == 0 {
        return Err("The selected game content folder is empty.".into());
    }
    Ok(canonical)
}

fn platform_steamcmd_relative_paths() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["builder/steamcmd.exe"]
    }
    #[cfg(target_os = "macos")]
    {
        &["builder_osx/steamcmd.sh", "builder_osx/steamcmd"]
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        &["builder_linux/steamcmd.sh", "builder_linux/steamcmd"]
    }
}

fn platform_steamcmd_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["steamcmd.exe"]
    }
    #[cfg(not(target_os = "windows"))]
    {
        &["steamcmd.sh", "steamcmd"]
    }
}

fn steamcmd_candidates(selected: &Path) -> Vec<PathBuf> {
    if selected.is_file() {
        return vec![selected.to_path_buf()];
    }

    let mut candidates = Vec::new();
    for name in platform_steamcmd_names() {
        candidates.push(selected.join(name));
    }
    for relative in platform_steamcmd_relative_paths() {
        candidates.push(selected.join(relative));
        candidates.push(selected.join("ContentBuilder").join(relative));
        candidates.push(selected.join("tools").join("ContentBuilder").join(relative));
    }
    candidates
}

fn resolve_steamcmd(sdk_path: &str) -> Result<PathBuf, Vec<String>> {
    if let Err(error) = validate_text("Steamworks SDK path", sdk_path, 4096, false) {
        return Err(vec![error]);
    }
    let selected = Path::new(sdk_path);
    if !selected.exists() {
        return Err(vec![
            "The selected Steamworks SDK path does not exist.".into()
        ]);
    }
    let selected_is_file = selected.is_file();
    let selected_root = if selected_is_file {
        None
    } else {
        match std::fs::canonicalize(selected) {
            Ok(path) => Some(path),
            Err(error) => {
                return Err(vec![format!(
                    "Could not open the selected Steamworks SDK folder: {error}"
                )])
            }
        }
    };

    let allowed_names = platform_steamcmd_names();
    let mut unusable = None;
    for candidate in steamcmd_candidates(selected) {
        let metadata = match std::fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => {
                unusable = Some(format!("Could not inspect SteamCMD: {error}"));
                continue;
            }
        };
        if metadata.file_type().is_symlink() {
            unusable = Some("SteamCMD cannot be a symbolic link.".into());
            continue;
        }
        if !metadata.is_file() {
            unusable = Some("The detected SteamCMD path is not a file.".into());
            continue;
        }
        let name_matches = candidate
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                allowed_names
                    .iter()
                    .any(|allowed| name.eq_ignore_ascii_case(allowed))
            });
        if !name_matches {
            unusable = Some("Select SteamCMD or a Steamworks SDK/ContentBuilder folder.".into());
            continue;
        }
        if !is_executable(&metadata) {
            unusable = Some("SteamCMD was found but is not executable.".into());
            continue;
        }
        let canonical = std::fs::canonicalize(&candidate)
            .map_err(|error| vec![format!("Could not open SteamCMD: {error}")])?;
        if selected_root
            .as_ref()
            .is_some_and(|root| !canonical.starts_with(root))
        {
            unusable =
                Some("SteamCMD cannot escape the selected SDK folder through a link.".into());
            continue;
        }
        return Ok(canonical);
    }

    let expected = platform_steamcmd_relative_paths().join(" or ");
    Err(vec![unusable.unwrap_or_else(|| {
    format!("SteamCMD was not found. Expected {expected} under the selected Steamworks SDK/ContentBuilder.")
  })])
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    true
}

fn ensure_safe_directory(path: &Path) -> Result<(), String> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("The Steam publishing cache contains an unsafe symbolic link.".into())
        }
        Ok(metadata) if !metadata.is_dir() => {
            Err("The Steam publishing cache path is not a directory.".into())
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            std::fs::create_dir_all(path)
                .map_err(|error| format!("Could not create the Steam publishing cache: {error}"))?;
            let metadata = std::fs::symlink_metadata(path).map_err(|error| {
                format!("Could not inspect the Steam publishing cache: {error}")
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                Err("The Steam publishing cache could not be created safely.".into())
            } else {
                Ok(())
            }
        }
        Err(error) => Err(format!(
            "Could not inspect the Steam publishing cache: {error}"
        )),
    }
}

fn write_new_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| format!("Could not create Steam build configuration: {error}"))?;
    file.write_all(contents)
        .map_err(|error| format!("Could not write Steam build configuration: {error}"))?;
    file.sync_all()
        .map_err(|error| format!("Could not finish Steam build configuration: {error}"))
}

fn vdf_escape(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '\\' => escaped.push_str("\\\\"),
            '"' => escaped.push_str("\\\""),
            '\n' => escaped.push_str("\\n"),
            '\r' => escaped.push_str("\\r"),
            '\t' => escaped.push_str("\\t"),
            other => escaped.push(other),
        }
    }
    escaped
}

fn vdf_path(path: &Path) -> String {
    vdf_escape(&path.to_string_lossy().replace('\\', "/"))
}

fn render_depot_vdf(depot_id: u32, content_root: &Path) -> String {
    format!(
    "\"DepotBuild\"\n{{\n  \"DepotID\" \"{depot_id}\"\n  \"ContentRoot\" \"{}\"\n  \"FileMapping\"\n  {{\n    \"LocalPath\" \"*\"\n    \"DepotPath\" \".\"\n    \"Recursive\" \"1\"\n  }}\n}}\n",
    vdf_path(content_root)
  )
}

fn render_app_vdf(
    request: &SteamPublishRequest,
    branch: Option<&str>,
    content_root: &Path,
    build_output: &Path,
    depot_vdf_path: &Path,
) -> String {
    let set_live = if !request.preview {
        branch
            .map(|branch| format!("  \"SetLive\" \"{}\"\n", vdf_escape(branch)))
            .unwrap_or_default()
    } else {
        String::new()
    };
    format!(
    "\"AppBuild\"\n{{\n  \"AppID\" \"{}\"\n  \"Desc\" \"{}\"\n  \"BuildOutput\" \"{}\"\n  \"ContentRoot\" \"{}\"\n  \"Preview\" \"{}\"\n{}  \"Depots\"\n  {{\n    \"{}\" \"{}\"\n  }}\n}}\n",
    request.app_id,
    vdf_escape(&request.description),
    vdf_path(build_output),
    vdf_path(content_root),
    if request.preview { 1 } else { 0 },
    set_live,
    request.depot_id,
    vdf_path(depot_vdf_path),
  )
}

fn spawn_output_reader<R: Read + Send + 'static>(
    output: R,
    app: AppHandle,
    account: String,
    observations: Arc<Mutex<ProcessObservations>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            match reader.read_until(b'\n', &mut bytes) {
                Ok(0) => break,
                Ok(_) => {
                    let line = String::from_utf8_lossy(&bytes)
                        .trim_end_matches(['\r', '\n'])
                        .to_string();
                    observe_output(&line, &observations);
                    let safe_line = redact_account(&line, &account);
                    let _ = app.emit("steam-publish-progress", safe_line);
                }
                Err(_) => break,
            }
        }
    })
}

fn observe_output(line: &str, observations: &Arc<Mutex<ProcessObservations>>) {
    let lowercase = line.to_ascii_lowercase();
    if let Ok(mut observations) = observations.lock() {
        if let Some(build_id) = parse_build_id(line) {
            observations.build_id = Some(build_id);
        }
        observations.authentication_failed |= [
            "failed to log",
            "login failure",
            "invalid password",
            "account logon denied",
            "steam guard",
            "two-factor",
            "two factor",
            "not logged on",
        ]
        .iter()
        .any(|pattern| lowercase.contains(pattern));
        observations.permission_failed |= [
            "access denied",
            "permission denied",
            "does not have permission",
            "missing required permission",
            "does not own",
            "not authorized",
        ]
        .iter()
        .any(|pattern| lowercase.contains(pattern));
        observations.build_failed |= [
            "error!",
            "failed to build app",
            "app build failed",
            "build failed",
        ]
        .iter()
        .any(|pattern| lowercase.contains(pattern));
    }
}

fn parse_build_id(line: &str) -> Option<String> {
    let lowercase = line.to_ascii_lowercase();
    let start = lowercase.rfind("buildid")? + "buildid".len();
    let remainder = &line[start..];
    let digit_start = remainder.find(|character: char| character.is_ascii_digit())?;
    let digits: String = remainder[digit_start..]
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    (!digits.is_empty()).then_some(digits)
}

fn redact_account(line: &str, account: &str) -> String {
    if account.is_empty() {
        line.to_string()
    } else {
        line.replace(account, "[steam-account]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(label: &str) -> Self {
            let path = std::env::temp_dir().join(format!(
                "feather-steam-{label}-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4().simple()
            ));
            std::fs::create_dir(&path).expect("create test directory");
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn request() -> SteamPublishRequest {
        SteamPublishRequest {
            sdk_path: "/sdk".into(),
            content_root: "/game".into(),
            account: "build_account".into(),
            app_id: 480,
            depot_id: 481,
            description: "Release candidate 1".into(),
            branch: Some("private-beta".into()),
            preview: false,
        }
    }

    #[test]
    fn serializes_the_agreed_camel_case_bridge() {
        let report = SteamToolReport {
            ready: true,
            steamcmd_path: Some("/sdk/steamcmd".into()),
            errors: vec![],
        };
        assert_eq!(
            serde_json::to_value(report).expect("serialize report"),
            serde_json::json!({
              "ready": true,
              "steamcmdPath": "/sdk/steamcmd",
              "errors": [],
            })
        );

        let value = serde_json::to_value(SteamPublishResult {
            status: SteamPublishStatus::LiveBeta,
            app_id: 480,
            depot_id: 481,
            build_id: Some("12345".into()),
            branch: Some("private-beta".into()),
        })
        .expect("serialize result");
        assert_eq!(value["status"], "live-beta");
        assert_eq!(value["appId"], 480);
        assert_eq!(value["depotId"], 481);
        assert_eq!(value["buildId"], "12345");
    }

    #[test]
    fn rejects_public_and_unsafe_branch_values() {
        assert!(validate_branch("default").is_err());
        assert!(validate_branch("PUBLIC").is_err());
        assert!(validate_branch("beta branch").is_err());
        assert!(validate_branch("beta\nbranch").is_err());
        assert_eq!(validate_branch("private-beta").unwrap(), "private-beta");
    }

    #[test]
    fn escapes_vdf_values_and_omits_setlive_during_preview() {
        assert_eq!(vdf_escape("a\\b\"c\n"), "a\\\\b\\\"c\\n");
        let mut request = request();
        request.preview = true;
        request.description = "Safe description".into();
        let vdf = render_app_vdf(
            &request,
            Some("private-beta"),
            Path::new("/game content"),
            Path::new("/cache"),
            Path::new("/jobs/depot.vdf"),
        );
        assert!(vdf.contains("\"Preview\" \"1\""));
        assert!(!vdf.contains("SetLive"));
        assert!(vdf.contains("\"481\" \"/jobs/depot.vdf\""));

        let depot_vdf = render_depot_vdf(481, Path::new("/game content"));
        assert!(depot_vdf.starts_with("\"DepotBuild\"\n{"));
        assert!(!depot_vdf.contains("DepotBuildConfig"));
    }

    #[test]
    fn treats_an_empty_optional_branch_as_upload_only() {
        let mut request = request();
        request.branch = Some(String::new());
        assert_eq!(validate_request(&request).unwrap(), None);
    }

    #[test]
    fn finds_the_platform_contentbuilder_steamcmd() {
        let sdk = TestDir::new("sdk");
        let relative = platform_steamcmd_relative_paths()[0];
        let executable = sdk.0.join("tools").join("ContentBuilder").join(relative);
        std::fs::create_dir_all(executable.parent().unwrap()).expect("create builder");
        std::fs::File::create(&executable).expect("create steamcmd");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755))
                .expect("make executable");
        }
        assert_eq!(
            resolve_steamcmd(sdk.0.to_str().unwrap()).unwrap(),
            std::fs::canonicalize(executable).unwrap()
        );
    }

    #[test]
    fn rejects_an_empty_content_root() {
        let content = TestDir::new("empty");
        assert!(validate_content_root(content.0.to_str().unwrap())
            .unwrap_err()
            .contains("empty"));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_inside_content() {
        use std::os::unix::fs::symlink;

        let content = TestDir::new("content-link");
        let outside = TestDir::new("outside-link");
        std::fs::write(outside.0.join("secret"), b"not game content").unwrap();
        symlink(outside.0.join("secret"), content.0.join("linked-file")).unwrap();
        assert!(validate_content_root(content.0.to_str().unwrap())
            .unwrap_err()
            .contains("symbolic links"));
    }

    #[test]
    fn parses_build_ids_without_confusing_app_ids() {
        assert_eq!(
            parse_build_id("Successfully finished AppID 480 build (BuildID 987654)."),
            Some("987654".into())
        );
        assert_eq!(parse_build_id("Building AppID 480"), None);
    }

    #[test]
    fn redacts_the_account_from_streamed_output() {
        assert_eq!(
            redact_account(
                "Logging in build_account for build_account",
                "build_account"
            ),
            "Logging in [steam-account] for [steam-account]"
        );
    }
}
