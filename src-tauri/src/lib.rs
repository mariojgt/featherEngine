mod collaboration;
mod steam_publishing;

use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_fs::FsExt;

use collaboration::{
  collaboration_status, register_collaboration_assets, start_collaboration, stop_collaboration,
  CollaborationManager,
};

const MAX_LINKED_TEXT_BYTES: usize = 4 * 1024 * 1024;
static LINKED_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct ScopedTempDir(PathBuf);

impl Drop for ScopedTempDir {
  fn drop(&mut self) {
    let _ = std::fs::remove_dir_all(&self.0);
  }
}

fn create_scoped_temp_dir(prefix: &str) -> Result<ScopedTempDir, String> {
  for _ in 0..32 {
    let sequence = LINKED_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let path = std::env::temp_dir().join(format!(
      "{prefix}-{}-{sequence}",
      std::process::id()
    ));
    match std::fs::create_dir(&path) {
      Ok(()) => return Ok(ScopedTempDir(path)),
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(format!("Could not create isolated build staging: {error}")),
    }
  }

  Err("Could not allocate a unique isolated build staging directory.".into())
}

fn ensure_project_scope(app: &AppHandle, project_dir: &str) -> Result<(), String> {
  let root = std::fs::canonicalize(project_dir)
    .map_err(|error| format!("Could not open the project directory: {error}"))?;
  let scope = app.fs_scope();
  if scope.is_forbidden(&root) || !scope.is_allowed(&root) {
    return Err("The project directory is outside Feather's authorized filesystem scope.".into());
  }
  Ok(())
}

fn validate_project_relative_path(relative_path: &str) -> Result<Vec<String>, String> {
  let portable = relative_path.replace('\\', "/");
  if portable.is_empty() || portable.len() > 1024 || portable.starts_with('/') {
    return Err(format!("Unsafe project-relative path: {relative_path}"));
  }
  if portable.as_bytes().get(1) == Some(&b':') {
    return Err(format!("Unsafe project-relative path: {relative_path}"));
  }

  let mut parts = Vec::new();
  for part in portable.split('/') {
    let lower = part.to_ascii_lowercase();
    let device = lower.split('.').next().unwrap_or_default();
    let reserved = matches!(device, "con" | "prn" | "aux" | "nul")
      || (device.len() == 4
        && (device.starts_with("com") || device.starts_with("lpt"))
        && matches!(device.as_bytes()[3], b'1'..=b'9'));
    let invalid_char = part.chars().any(|character| {
      character.is_control() || matches!(character, '<' | '>' | ':' | '"' | '|' | '?' | '*')
    });
    if part.is_empty()
      || part == "."
      || part == ".."
      || part.len() > 240
      || part.ends_with('.')
      || part.ends_with(' ')
      || reserved
      || invalid_char
    {
      return Err(format!("Unsafe project-relative path: {relative_path}"));
    }
    parts.push(part.to_string());
  }
  Ok(parts)
}

fn checked_project_target(
  project_dir: &str,
  relative_path: &str,
  create_parent: bool,
) -> Result<PathBuf, String> {
  let parts = validate_project_relative_path(relative_path)?;
  let root = std::fs::canonicalize(project_dir)
    .map_err(|error| format!("Could not open the project directory: {error}"))?;
  if !root.is_dir() {
    return Err("The selected project path is not a directory.".into());
  }

  let file_name = parts.last().ok_or_else(|| "Linked file name is missing.".to_string())?;
  let mut lexical_parent = root.clone();
  for part in &parts[..parts.len() - 1] {
    lexical_parent.push(part);
    match std::fs::symlink_metadata(&lexical_parent) {
      Ok(metadata) if metadata.file_type().is_symlink() => {
        return Err(format!(
          "Linked project path cannot contain a symbolic link: {relative_path}"
        ));
      }
      Ok(metadata) if !metadata.is_dir() => {
        return Err(format!("Linked project parent is not a directory: {relative_path}"));
      }
      Ok(_) => {}
      Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
        if create_parent {
          std::fs::create_dir(&lexical_parent).map_err(|error| error.to_string())?;
        } else {
          return Ok(lexical_parent.join(file_name));
        }
      }
      Err(error) => return Err(error.to_string()),
    }
  }

  let parent = std::fs::canonicalize(&lexical_parent).map_err(|error| error.to_string())?;
  if !parent.starts_with(&root) {
    return Err(format!("Linked project path escapes its project: {relative_path}"));
  }
  let target = parent.join(file_name);
  match std::fs::symlink_metadata(&target) {
    Ok(metadata) if metadata.file_type().is_symlink() => Err(format!(
      "Linked project path cannot be a symbolic link: {relative_path}"
    )),
    Ok(metadata) if !metadata.is_file() => {
      Err(format!("Linked project path is not a file: {relative_path}"))
    }
    Ok(_) | Err(_) => Ok(target),
  }
}

fn read_project_text_impl(
  project_dir: &str,
  relative_path: &str,
) -> Result<Option<String>, String> {
  let target = checked_project_target(project_dir, relative_path, false)?;
  read_linked_text_file(&target, relative_path)
}

fn read_linked_text_file(
  target: &std::path::Path,
  relative_path: &str,
) -> Result<Option<String>, String> {
  let file = match OpenOptions::new().read(true).open(target) {
    Ok(file) => file,
    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(error) => return Err(error.to_string()),
  };
  let metadata = file.metadata().map_err(|error| error.to_string())?;
  if !metadata.is_file() {
    return Err(format!("Linked project path is not a file: {relative_path}"));
  }
  if metadata.len() > MAX_LINKED_TEXT_BYTES as u64 {
    return Err("Linked project text files are limited to 4 MiB.".into());
  }
  let mut bytes = Vec::with_capacity(metadata.len() as usize);
  file
    .take((MAX_LINKED_TEXT_BYTES + 1) as u64)
    .read_to_end(&mut bytes)
    .map_err(|error| error.to_string())?;
  if bytes.len() > MAX_LINKED_TEXT_BYTES {
    return Err("Linked project text files are limited to 4 MiB.".into());
  }
  String::from_utf8(bytes)
    .map(Some)
    .map_err(|_| "Linked project text must be valid UTF-8.".into())
}

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
enum ProjectTextWriteResult {
  Written,
  Changed {
    #[serde(rename = "currentContents")]
    current_contents: Option<String>,
    #[serde(rename = "recoveryPath", skip_serializing_if = "Option::is_none")]
    recovery_path: Option<String>,
  },
}

fn create_linked_swap_directory(parent: &std::path::Path) -> Result<PathBuf, String> {
  for _ in 0..16 {
    let sequence = LINKED_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let candidate = parent.join(format!("nf-swap-{}-{sequence}", std::process::id()));
    match std::fs::create_dir(&candidate) {
      Ok(()) => return Ok(candidate),
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(error.to_string()),
    }
  }
  Err("Could not create a linked-script swap directory.".into())
}

fn recovery_relative_path(project_dir: &str, backup: &std::path::Path) -> Option<String> {
  let root = std::fs::canonicalize(project_dir).ok()?;
  Some(
    backup
      .strip_prefix(root)
      .ok()?
      .to_string_lossy()
      .replace('\\', "/"),
  )
}

fn restore_linked_backup(backup: &std::path::Path, target: &std::path::Path) -> bool {
  if std::fs::hard_link(backup, target).is_err() {
    return false;
  }
  let _ = std::fs::remove_file(backup);
  true
}

fn write_project_text_atomic_impl(
  project_dir: &str,
  relative_path: &str,
  contents: &str,
  check_expected: bool,
  expected_contents: Option<&str>,
) -> Result<ProjectTextWriteResult, String> {
  if contents.len() > MAX_LINKED_TEXT_BYTES {
    return Err("Linked project text files are limited to 4 MiB.".into());
  }
  if expected_contents.is_some_and(|expected| expected.len() > MAX_LINKED_TEXT_BYTES) {
    return Err("Linked project text files are limited to 4 MiB.".into());
  }
  let target = checked_project_target(project_dir, relative_path, true)?;
  let current_contents = read_linked_text_file(&target, relative_path)?;
  if check_expected && current_contents.as_deref() != expected_contents {
    return Ok(ProjectTextWriteResult::Changed {
      current_contents,
      recovery_path: None,
    });
  }
  // Calls without an explicit guard still use the snapshot just read as their compare-and-swap
  // baseline. This keeps the low-level helper from silently replacing a concurrent editor save.
  let guarded_contents = if check_expected {
    expected_contents.map(str::to_owned)
  } else {
    current_contents
  };
  let parent = target.parent().ok_or_else(|| "Linked file parent is missing.".to_string())?;
  let mut temporary = None;
  for _ in 0..16 {
    let sequence = LINKED_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let candidate = parent.join(format!("nf-write-{}-{sequence}.tmp", std::process::id()));
    match OpenOptions::new().create_new(true).write(true).open(&candidate) {
      Ok(file) => {
        temporary = Some((candidate, file));
        break;
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
      Err(error) => return Err(error.to_string()),
    }
  }
  let (temporary_path, mut temporary_file) = temporary
    .ok_or_else(|| "Could not create a temporary linked-script file.".to_string())?;
  let prepare_result = (|| -> Result<(), String> {
    temporary_file
      .write_all(contents.as_bytes())
      .map_err(|error| error.to_string())?;
    temporary_file.flush().map_err(|error| error.to_string())?;
    temporary_file.sync_all().map_err(|error| error.to_string())?;
    drop(temporary_file);
    Ok(())
  })();
  if let Err(error) = prepare_result {
    let _ = std::fs::remove_file(&temporary_path);
    return Err(error);
  }

  // Creating a missing target through a hard link is an atomic no-clobber operation on every
  // supported desktop platform. If an editor wins the race, its file remains untouched.
  if guarded_contents.is_none() {
    return match std::fs::hard_link(&temporary_path, &target) {
      Ok(()) => {
        let _ = std::fs::remove_file(&temporary_path);
        Ok(ProjectTextWriteResult::Written)
      }
      Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
        let _ = std::fs::remove_file(&temporary_path);
        Ok(ProjectTextWriteResult::Changed {
          current_contents: read_linked_text_file(&target, relative_path)?,
          recovery_path: None,
        })
      }
      Err(error) => {
        let _ = std::fs::remove_file(&temporary_path);
        Err(error.to_string())
      }
    };
  }

  // Move whatever currently occupies the target into a uniquely reserved directory. This closes
  // the final read/rename window: a late external save is either detected in the backup or appears
  // as a new target that the no-clobber install below refuses to replace.
  let swap_directory = match create_linked_swap_directory(parent) {
    Ok(path) => path,
    Err(error) => {
      let _ = std::fs::remove_file(&temporary_path);
      return Err(error);
    }
  };
  let backup = swap_directory.join("displaced.feather");
  if let Err(error) = std::fs::rename(&target, &backup) {
    let _ = std::fs::remove_file(&temporary_path);
    let _ = std::fs::remove_dir(&swap_directory);
    if error.kind() == std::io::ErrorKind::NotFound {
      return Ok(ProjectTextWriteResult::Changed {
        current_contents: read_linked_text_file(&target, relative_path)?,
        recovery_path: None,
      });
    }
    return Err(error.to_string());
  }

  let displaced_contents = match read_linked_text_file(&backup, relative_path) {
    Ok(contents) => contents,
    Err(error) => {
      let _ = restore_linked_backup(&backup, &target);
      let _ = std::fs::remove_file(&temporary_path);
      let _ = std::fs::remove_dir(&swap_directory);
      return Err(error);
    }
  };
  if displaced_contents != guarded_contents {
    let _ = std::fs::remove_file(&temporary_path);
    let restored = restore_linked_backup(&backup, &target);
    let recovery_path = if restored {
      let _ = std::fs::remove_dir(&swap_directory);
      None
    } else {
      recovery_relative_path(project_dir, &backup)
    };
    return Ok(ProjectTextWriteResult::Changed {
      current_contents: displaced_contents,
      recovery_path,
    });
  }

  match std::fs::hard_link(&temporary_path, &target) {
    Ok(()) => {
      let _ = std::fs::remove_file(&temporary_path);
      let _ = std::fs::remove_file(&backup);
      let _ = std::fs::remove_dir(&swap_directory);
      Ok(ProjectTextWriteResult::Written)
    }
    Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
      let _ = std::fs::remove_file(&temporary_path);
      // A new external file appeared after the old target was moved aside. Preserve it and report
      // the current disk contents; the displaced checkpoint is no longer needed.
      let _ = std::fs::remove_file(&backup);
      let _ = std::fs::remove_dir(&swap_directory);
      Ok(ProjectTextWriteResult::Changed {
        current_contents: read_linked_text_file(&target, relative_path)?,
        recovery_path: None,
      })
    }
    Err(error) => {
      let restored = restore_linked_backup(&backup, &target);
      let _ = std::fs::remove_file(&temporary_path);
      if restored {
        let _ = std::fs::remove_dir(&swap_directory);
      }
      Err(error.to_string())
    }
  }
}

#[cfg(test)]
mod linked_project_file_tests {
  use super::*;

  struct TestProject(PathBuf);

  impl TestProject {
    fn new(label: &str) -> Self {
      let sequence = LINKED_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
      let path = std::env::temp_dir().join(format!(
        "nodeforge-linked-{label}-{}-{sequence}",
        std::process::id()
      ));
      std::fs::create_dir(&path).expect("create test project");
      Self(path)
    }

    fn path(&self) -> &str {
      self.0.to_str().expect("UTF-8 test path")
    }
  }

  impl Drop for TestProject {
    fn drop(&mut self) {
      let _ = std::fs::remove_dir_all(&self.0);
    }
  }

  #[test]
  fn rejects_non_portable_relative_paths() {
    for path in [
      "../outside.feather",
      "scripts/../outside.feather",
      "/tmp/outside.feather",
      "C:\\outside.feather",
      "scripts/CON.feather",
      "scripts/file.feather:stream",
    ] {
      assert!(validate_project_relative_path(path).is_err(), "accepted {path}");
    }
    assert!(validate_project_relative_path("scripts/player.feather").is_ok());
  }

  #[test]
  fn production_targets_are_exact_and_stageable() {
    assert!(validate_production_targets(&[
      "web".into(),
      "windows".into(),
      "macos".into(),
      "linux".into(),
      "android".into(),
      "ios".into(),
    ])
    .is_ok());
    assert!(validate_production_targets(&["desktop".into()])
      .expect_err("legacy ambiguous target should fail")
      .contains("Unknown export target"));
    assert!(validate_production_targets(&["web".into(), "web".into()])
      .expect_err("duplicate targets should fail")
      .contains("Duplicate"));
  }

  #[test]
  fn atomically_replaces_and_reads_linked_utf8_text() {
    let project = TestProject::new("roundtrip");
    write_project_text_atomic_impl(
      project.path(),
      "scripts/player.feather",
      "blueprint Player\n",
      true,
      None,
    )
    .expect("first write");
    write_project_text_atomic_impl(
      project.path(),
      "scripts/player.feather",
      "blueprint Player\n\non start:\n    pass\n",
      true,
      Some("blueprint Player\n"),
    )
    .expect("replacement write");

    assert_eq!(
      read_project_text_impl(project.path(), "scripts/player.feather")
        .expect("read")
        .as_deref(),
      Some("blueprint Player\n\non start:\n    pass\n")
    );
    let leftovers = std::fs::read_dir(project.0.join("scripts"))
      .expect("read scripts")
      .filter_map(Result::ok)
      .filter(|entry| entry.file_name().to_string_lossy().starts_with("nf-write-"))
      .count();
    assert_eq!(leftovers, 0);
  }

  #[test]
  fn refuses_to_replace_contents_that_no_longer_match() {
    let project = TestProject::new("compare-swap");
    std::fs::create_dir(project.0.join("scripts")).expect("create scripts");
    std::fs::write(
      project.0.join("scripts/player.feather"),
      "blueprint Player\n\non start:\n    print(\"external\")\n",
    )
    .expect("write external source");

    let result = write_project_text_atomic_impl(
      project.path(),
      "scripts/player.feather",
      "blueprint Player\n\non start:\n    print(\"feather\")\n",
      true,
      Some("blueprint Player\n"),
    )
    .expect("guarded write result");

    assert!(matches!(result, ProjectTextWriteResult::Changed { .. }));
    assert_eq!(
      std::fs::read_to_string(project.0.join("scripts/player.feather")).expect("read source"),
      "blueprint Player\n\non start:\n    print(\"external\")\n"
    );
  }

  #[test]
  fn refuses_to_create_over_a_file_that_already_exists() {
    let project = TestProject::new("create-swap");
    std::fs::create_dir(project.0.join("scripts")).expect("create scripts");
    std::fs::write(
      project.0.join("scripts/player.feather"),
      "blueprint External\n",
    )
    .expect("write external source");

    let result = write_project_text_atomic_impl(
      project.path(),
      "scripts/player.feather",
      "blueprint Feather\n",
      true,
      None,
    )
    .expect("guarded create result");

    assert!(matches!(result, ProjectTextWriteResult::Changed { .. }));
    assert_eq!(
      std::fs::read_to_string(project.0.join("scripts/player.feather")).expect("read source"),
      "blueprint External\n"
    );
  }

  #[test]
  fn serializes_guarded_write_results_for_the_typescript_platform() {
    assert_eq!(
      serde_json::to_value(ProjectTextWriteResult::Written).expect("serialize written result"),
      serde_json::json!({ "kind": "written" })
    );
    assert_eq!(
      serde_json::to_value(ProjectTextWriteResult::Changed {
        current_contents: Some("external".into()),
        recovery_path: Some("scripts/nf-swap/displaced.feather".into()),
      })
      .expect("serialize changed result"),
      serde_json::json!({
        "kind": "changed",
        "currentContents": "external",
        "recoveryPath": "scripts/nf-swap/displaced.feather",
      })
    );
  }

  #[test]
  fn bounds_reads_using_the_open_file_handle() {
    let project = TestProject::new("size");
    let scripts = project.0.join("scripts");
    std::fs::create_dir(&scripts).expect("create scripts");
    std::fs::write(
      scripts.join("large.feather"),
      vec![b'x'; MAX_LINKED_TEXT_BYTES + 1],
    )
    .expect("write oversized source");

    assert!(read_project_text_impl(project.path(), "scripts/large.feather").is_err());
  }

  #[cfg(unix)]
  #[test]
  fn rejects_a_symlinked_project_component() {
    use std::os::unix::fs::symlink;

    let project = TestProject::new("symlink-project");
    let outside = TestProject::new("symlink-outside");
    symlink(&outside.0, project.0.join("scripts")).expect("create symlink");

    assert!(write_project_text_atomic_impl(
      project.path(),
      "scripts/player.feather",
      "blueprint Player\n",
      true,
      None,
    )
    .is_err());
    assert!(!outside.0.join("player.feather").exists());
  }
}

#[tauri::command]
async fn read_project_text(
  app: AppHandle,
  project_dir: String,
  relative_path: String,
) -> Result<Option<String>, String> {
  ensure_project_scope(&app, &project_dir)?;
  tauri::async_runtime::spawn_blocking(move || {
    read_project_text_impl(&project_dir, &relative_path)
  })
  .await
  .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn write_project_text_atomic(
  app: AppHandle,
  project_dir: String,
  relative_path: String,
  contents: String,
  check_expected: bool,
  expected_contents: Option<String>,
) -> Result<ProjectTextWriteResult, String> {
  ensure_project_scope(&app, &project_dir)?;
  tauri::async_runtime::spawn_blocking(move || {
    write_project_text_atomic_impl(
      &project_dir,
      &relative_path,
      &contents,
      check_expected,
      expected_contents.as_deref(),
    )
  })
  .await
  .map_err(|error| error.to_string())?
}

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

fn validate_production_targets(targets: &[String]) -> Result<(), String> {
  if targets.is_empty() {
    return Err("Select at least one production export target.".into());
  }
  let mut seen = std::collections::HashSet::new();
  for target in targets {
    if !seen.insert(target.as_str()) {
      return Err(format!("Duplicate export target: {target}"));
    }
    match target.as_str() {
      "web" | "windows" | "macos" | "linux" | "android" | "ios" => {}
      other => return Err(format!("Unknown export target: {other}")),
    }
  }
  Ok(())
}

/// Run the production export pipeline for the staged game bundle, streaming each output line to
/// the frontend as a `production-build-progress` event. `targets` contains exact platform ids
/// (web/windows/macos/linux/android/ios). Targets that need a different host are staged with an
/// actionable runner command. `profile_json` is staged beside the bundle so the Node/Tauri packager
/// applies the same immutable identity, launch-scene, version and window settings the editor audited.
#[tauri::command]
async fn run_production_build(
  app: AppHandle,
  bundle_json: String,
  profile_json: String,
  targets: Vec<String>,
  out_dir: Option<String>,
) -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let root = find_engine_root()?;
    validate_production_targets(&targets)?;

    // Stage the exact audited bundle/profile pair. The script validates both again before writing
    // any output, so direct command invocation has the same parity gate as the editor flow.
    let staging_guard = create_scoped_temp_dir("nodeforge-production")?;
    let staging = staging_guard.0.clone();
    let _staging_guard = staging_guard;
    let bundle_path = staging.join("game.json");
    let profile_path = staging.join("export-profile.json");
    std::fs::write(&bundle_path, &bundle_json).map_err(|e| e.to_string())?;
    std::fs::write(&profile_path, &profile_json).map_err(|e| e.to_string())?;

    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let _ = app.emit(
      "production-build-progress",
      format!("Starting build ({})…", targets.join(" + ")),
    );

    // npm run export:build -- --bundle <path> --profile <path> --targets <exact,csv> --zip
    let mut args: Vec<String> = vec![
      "run".into(),
      "export:build".into(),
      "--".into(),
      "--bundle".into(),
      bundle_path.to_string_lossy().into_owned(),
      "--profile".into(),
      profile_path.to_string_lossy().into_owned(),
      "--targets".into(),
      targets.join(","),
      "--zip".into(),
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

/// Run the platform doctor (scripts/platform-doctor.mjs --json) and return its JSON report:
/// per export platform, whether this machine can build it right now, what is missing (with fix
/// hints), or whether it should be built on CI. The frontend export dialog renders this.
#[tauri::command]
async fn check_export_platforms() -> Result<String, String> {
  tauri::async_runtime::spawn_blocking(move || {
    let root = find_engine_root()?;
    let output = Command::new("node")
      .args(["scripts/platform-doctor.mjs", "--json"])
      .current_dir(&root)
      .output()
      .map_err(|e| format!("Failed to run the platform doctor (is node on your PATH?): {e}"))?;
    if !output.status.success() {
      return Err(format!(
        "Platform doctor failed: {}",
        String::from_utf8_lossy(&output.stderr)
      ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
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
    Ok(())
  }

  #[cfg(target_os = "macos")]
  {
    Command::new("open")
      .arg("-R")
      .arg(&p)
      .spawn()
      .map_err(|e| e.to_string())?;
    Ok(())
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
    .manage(CollaborationManager::default())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      run_production_build,
      steam_publishing::check_steam_tools,
      steam_publishing::run_steam_publish,
      check_export_platforms,
      reveal_in_explorer,
      read_project_text,
      write_project_text_atomic,
      start_collaboration,
      stop_collaboration,
      collaboration_status,
      register_collaboration_assets
    ])
    .on_window_event(|window, event| {
      if window.label() == "main" && matches!(event, WindowEvent::Destroyed) {
        window.state::<CollaborationManager>().shutdown_now();
      }
    })
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
