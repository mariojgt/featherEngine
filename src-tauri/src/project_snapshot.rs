//! Project saves publish one manifest after all immutable scene files are durable.
//! A process interruption therefore exposes the old or the new complete snapshot.
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SCENE_STORAGE: &str = "scenes/.feather";
const BACKUPS: &str = ".feather/backups";
const MAX_TEXT_BYTES: usize = 512 * 1024 * 1024;
const BACKUP_COUNT: usize = 3;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveResult {
    pub revision: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult {
    pub manifest: Value,
    pub scenes: Vec<Value>,
    /// Revision of project.json, including a damaged current file when opening a backup.
    pub revision: Option<String>,
    pub recovered_from: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Backup {
    format: String,
    format_version: u32,
    manifest: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SavePhase {
    SceneWritten,
    BackupWritten,
    BeforeCommit,
    Committed,
}

fn checksum(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn project_root(dir: &Path) -> Result<PathBuf, String> {
    let root =
        fs::canonicalize(dir).map_err(|e| format!("Could not open the project folder: {e}"))?;
    if !root.is_dir() {
        return Err("The project path is not a folder.".into());
    }
    Ok(root)
}

fn checked_path(root: &Path, relative: &str, create_parent: bool) -> Result<PathBuf, String> {
    let portable = relative.replace('\\', "/");
    let mut path = root.to_path_buf();
    let parts: Vec<_> = portable.split('/').collect();
    if portable.len() > 1024 || portable.starts_with('/') {
        return Err(format!("Unsafe project path: {relative}"));
    }
    for (index, part) in parts.iter().enumerate() {
        let device = part
            .split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let reserved = matches!(device.as_str(), "con" | "prn" | "aux" | "nul")
            || (device.len() == 4
                && (device.starts_with("com") || device.starts_with("lpt"))
                && matches!(device.as_bytes()[3], b'1'..=b'9'));
        if part.is_empty()
            || *part == "."
            || *part == ".."
            || part.len() > 240
            || part.ends_with('.')
            || part.ends_with(' ')
            || reserved
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"|?*".contains(c))
        {
            return Err(format!("Unsafe project path: {relative}"));
        }
        path.push(part);
        let is_parent = index + 1 < parts.len();
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(format!("Project path contains a symbolic link: {relative}"));
            }
            Ok(meta) if is_parent && !meta.is_dir() => {
                return Err(format!("Project parent is not a folder: {relative}"));
            }
            Ok(meta) if !is_parent && !meta.is_file() => {
                return Err(format!("Project path is not a file: {relative}"));
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if is_parent && create_parent {
                    fs::create_dir(&path)
                        .map_err(|e| format!("Could not create project folder: {e}"))?;
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(path)
}

fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|e| format!("Could not read {}: {e}", path.display()))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_TEXT_BYTES as u64 {
        return Err("Project text exceeds the 512 MiB safety limit.".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_TEXT_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_TEXT_BYTES {
        return Err("Project text exceeds the 512 MiB safety limit.".into());
    }
    Ok(bytes)
}

fn read_text(path: &Path) -> Result<String, String> {
    String::from_utf8(read_bytes(path)?).map_err(|_| {
        format!(
            "Project text is damaged (invalid UTF-8): {}",
            path.display()
        )
    })
}

fn current_bytes(root: &Path) -> Result<Option<Vec<u8>>, String> {
    let path = checked_path(root, "project.json", false)?;
    if !path.exists() {
        return Ok(None);
    }
    read_bytes(&path).map(Some)
}

fn acquire_lock(root: &Path, write: bool) -> Result<Option<File>, String> {
    let path = checked_path(root, ".feather/save.lock", write)?;
    if !write && !path.exists() {
        return Ok(None);
    }
    let file = OpenOptions::new()
        .read(true)
        .write(write)
        .create(write)
        .truncate(false)
        .open(path)
        .map_err(|e| format!("Could not lock the project: {e}"))?;
    if write {
        FileExt::lock_exclusive(&file)
    } else {
        FileExt::lock_shared(&file)
    }
    .map_err(|e| format!("Could not lock the project: {e}"))?;
    Ok(Some(file)) // OS releases the lock on close, including after a process crash.
}

fn scene_refs(manifest: &Value) -> Result<Vec<(&str, &str)>, String> {
    version(manifest)?;
    for key in [
        "assets",
        "folders",
        "variables",
        "dataAssets",
        "dataTables",
        "materials",
        "particleSystems",
        "skeletons",
        "skeletalMeshes",
        "animations",
        "animatorControllers",
        "uiDocuments",
        "blueprints",
        "graphs",
        "prefabs",
        "treeSpecs",
        "modelSpecs",
    ] {
        if manifest
            .get(key)
            .is_some_and(|value| !value.is_null() && !value.is_array())
        {
            return Err(format!("Project manifest's {key} must be an array."));
        }
    }
    if !manifest.get("name").is_some_and(Value::is_string) {
        return Err("Project manifest is missing its name.".into());
    }
    let scenes = manifest
        .get("scenes")
        .and_then(Value::as_array)
        .filter(|s| !s.is_empty())
        .ok_or("Project manifest must contain at least one scene.")?;
    let mut ids = HashSet::new();
    let mut files = HashSet::new();
    let mut result = Vec::new();
    for scene in scenes {
        let id = scene
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("Project scene is missing its id.")?;
        let path = scene
            .get("file")
            .and_then(Value::as_str)
            .filter(|s| s.starts_with("scenes/"))
            .ok_or("Project scene file must be inside scenes/.")?;
        if !ids.insert(id) || !files.insert(path) {
            return Err("Project manifest contains duplicate scenes or files.".into());
        }
        result.push((id, path));
    }
    Ok(result)
}

fn owned_scene_hash(relative: &str) -> Option<&str> {
    let hash = relative
        .strip_prefix("scenes/.feather/")?
        .strip_suffix(".scene.json")?;
    (hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)))
    .then_some(hash)
}

fn read_snapshot(root: &Path, raw: &str) -> Result<(Value, Vec<Value>), String> {
    let manifest: Value =
        serde_json::from_str(raw).map_err(|e| format!("Project manifest is damaged: {e}"))?;
    let mut scenes = Vec::new();
    for (id, relative) in scene_refs(&manifest)? {
        let text = read_text(&checked_path(root, relative, false)?)?;
        if owned_scene_hash(relative).is_some_and(|hash| hash != checksum(text.as_bytes())) {
            return Err(format!("Saved scene failed its integrity check: {id}"));
        }
        let scene: Value = serde_json::from_str(&text)
            .map_err(|e| format!("Saved scene is damaged: {id}: {e}"))?;
        if scene.get("id").and_then(Value::as_str) != Some(id)
            || !scene.get("objects").is_some_and(Value::is_array)
        {
            return Err(format!("Saved scene does not match its manifest: {id}"));
        }
        scenes.push(scene);
    }
    Ok((manifest, scenes))
}

fn backup_files(root: &Path) -> Result<Vec<String>, String> {
    let directory = checked_path(root, &format!("{BACKUPS}/placeholder"), false)?;
    let parent = directory.parent().unwrap();
    if !parent.exists() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with("backup-")
            && name.ends_with(".json")
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            files.push(format!("{BACKUPS}/{name}"));
        }
    }
    files.sort_by(|a, b| b.cmp(a));
    Ok(files)
}

fn read_backup(root: &Path, path: &str) -> Result<String, String> {
    let backup: Backup = serde_json::from_str(&read_text(&checked_path(root, path, false)?)?)
        .map_err(|e| format!("Saved backup is damaged: {e}"))?;
    if backup.format != "feather-project-backup" || backup.format_version != 1 {
        return Err("Unknown project backup format.".into());
    }
    Ok(backup.manifest)
}

pub fn read_project(dir: &Path, previous: bool) -> Result<ReadResult, String> {
    let root = project_root(dir)?;
    let _lock = acquire_lock(&root, false)?;
    let current = current_bytes(&root)?;
    let revision = current.as_ref().map(|bytes| checksum(bytes));
    let mut current_error = "No project.json found in that folder.".to_string();
    if !previous {
        if let Some(bytes) = &current {
            let snapshot = std::str::from_utf8(bytes)
                .map_err(|_| "Project manifest is damaged (invalid UTF-8).".to_string())
                .and_then(|text| read_snapshot(&root, text));
            match snapshot {
                Ok((manifest, scenes)) => {
                    return Ok(ReadResult {
                        manifest,
                        scenes,
                        revision,
                        recovered_from: None,
                    })
                }
                Err(error) => current_error = error,
            }
        }
    }
    for path in backup_files(&root)? {
        if let Ok(raw) = read_backup(&root, &path) {
            if let Ok((manifest, scenes)) = read_snapshot(&root, &raw) {
                return Ok(ReadResult {
                    manifest,
                    scenes,
                    revision,
                    recovered_from: Some(path),
                });
            }
        }
    }
    if previous {
        Err("No complete previous save is available for this project.".into())
    } else {
        Err(format!(
            "{current_error} No complete saved backup could be recovered."
        ))
    }
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|e| format!("Could not flush the project folder: {e}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

/// Stage on the destination filesystem and replace with a single rename. Never remove the target.
fn replace_text(root: &Path, relative: &str, contents: &str) -> Result<(), String> {
    replace_bytes(root, relative, contents.as_bytes())
}

fn replace_bytes(root: &Path, relative: &str, contents: &[u8]) -> Result<(), String> {
    let target = checked_path(root, relative, true)?;
    let parent = target.parent().unwrap();
    let temporary = parent.join(format!("stage-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|e| e.to_string())?;
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Could not write the project snapshot: {e}"))?;
        drop(file);
        fs::rename(&temporary, &target)
            .map_err(|e| format!("Could not publish the project snapshot: {e}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

fn version(value: &Value) -> Result<[u64; 3], String> {
    let Some(text) = value.get("version") else {
        return Ok([0, 0, 0]);
    };
    let parts: Vec<_> = text
        .as_str()
        .ok_or("Invalid project version.")?
        .split('.')
        .collect();
    if parts.len() != 3 {
        return Err("Invalid project version.".into());
    }
    let mut result = [0; 3];
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || !part.bytes().all(|c| c.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return Err("Invalid project version.".into());
        }
        result[index] = part.parse().map_err(|_| "Invalid project version.")?;
    }
    Ok(result)
}

fn prune(root: &Path, current: &Value) -> Result<(), String> {
    let files = backup_files(root)?;
    let mut used = HashSet::new();
    for (_, path) in scene_refs(current)? {
        used.insert(path.to_string());
    }
    // Read every retained manifest before deleting anything, so damage cannot discard its scenes.
    for path in files.iter().take(BACKUP_COUNT) {
        let manifest: Value =
            serde_json::from_str(&read_backup(root, path)?).map_err(|e| e.to_string())?;
        for (_, file) in scene_refs(&manifest)? {
            used.insert(file.to_string());
        }
    }
    for path in files.iter().skip(BACKUP_COUNT) {
        fs::remove_file(checked_path(root, path, false)?).map_err(|e| e.to_string())?;
    }
    let storage = checked_path(root, &format!("{SCENE_STORAGE}/placeholder"), false)?;
    for entry in fs::read_dir(storage.parent().unwrap()).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let relative = format!("{SCENE_STORAGE}/{}", entry.file_name().to_string_lossy());
        if owned_scene_hash(&relative).is_some()
            && !used.contains(&relative)
            && entry.file_type().map_err(|e| e.to_string())?.is_file()
        {
            fs::remove_file(checked_path(root, &relative, false)?).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn save_project(
    dir: &Path,
    manifest_json: &str,
    scene_jsons: &[String],
    expected_revision: Option<&str>,
) -> Result<SaveResult, String> {
    save_with_hook(dir, manifest_json, scene_jsons, expected_revision, |_| {
        Ok(())
    })
}

fn save_with_hook<F: FnMut(SavePhase) -> Result<(), String>>(
    dir: &Path,
    manifest_json: &str,
    scene_jsons: &[String],
    expected_revision: Option<&str>,
    mut hook: F,
) -> Result<SaveResult, String> {
    if manifest_json.len() > MAX_TEXT_BYTES
        || scene_jsons.iter().any(|text| text.len() > MAX_TEXT_BYTES)
    {
        return Err("Project text exceeds the 512 MiB safety limit.".into());
    }
    let root = project_root(dir)?;
    let mut manifest: Value = serde_json::from_str(manifest_json)
        .map_err(|e| format!("Invalid project manifest: {e}"))?;
    let incoming_version = version(&manifest)?;
    let ids: Vec<_> = scene_refs(&manifest)?
        .iter()
        .map(|(id, _)| id.to_string())
        .collect();
    for (_, path) in scene_refs(&manifest)? {
        checked_path(&root, path, false)?;
    }
    if ids.len() != scene_jsons.len() {
        return Err("The save must include every scene exactly once.".into());
    }
    let mut prepared = HashMap::new();
    for text in scene_jsons {
        let scene: Value = serde_json::from_str(text).map_err(|e| format!("Invalid scene: {e}"))?;
        let id = scene
            .get("id")
            .and_then(Value::as_str)
            .ok_or("Scene is missing its id.")?;
        if !scene.get("objects").is_some_and(Value::is_array)
            || !ids.iter().any(|wanted| wanted == id)
            || prepared.insert(id.to_string(), text).is_some()
        {
            return Err("The save contains an invalid or duplicate scene.".into());
        }
    }
    let _lock = acquire_lock(&root, true)?;
    let old = current_bytes(&root)?;
    let old_revision = old.as_ref().map(|bytes| checksum(bytes));
    if old_revision.as_deref() != expected_revision {
        return Err("This project changed on disk. Reopen it or use Save as to keep your edits without replacing the other save.".into());
    }
    if let Some(text) = &old {
        if let Ok(value) = serde_json::from_slice::<Value>(text) {
            if version(&value)? > incoming_version {
                return Err("This project was saved by a newer Feather Engine. Update Feather before saving it.".into());
            }
        }
    }
    for reference in manifest.get_mut("scenes").unwrap().as_array_mut().unwrap() {
        let id = reference.get("id").unwrap().as_str().unwrap();
        let contents = prepared.get(id).unwrap();
        let relative = format!(
            "{SCENE_STORAGE}/{}.scene.json",
            checksum(contents.as_bytes())
        );
        let target = checked_path(&root, &relative, true)?;
        if !target.exists() || read_text(&target)? != **contents {
            replace_text(&root, &relative, contents)?;
        }
        reference["file"] = Value::String(relative);
        hook(SavePhase::SceneWritten)?;
    }
    sync_directory(&root.join(SCENE_STORAGE))?;
    sync_directory(&root.join("scenes"))?;
    if let Some(text) = &old {
        let micros = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_micros();
        let valid = std::str::from_utf8(text)
            .ok()
            .filter(|raw| read_snapshot(&root, raw).is_ok());
        if let Some(raw) = valid {
            let relative = format!(
                "{BACKUPS}/backup-{micros:020}-{}.json",
                uuid::Uuid::new_v4()
            );
            let backup = Backup {
                format: "feather-project-backup".into(),
                format_version: 1,
                manifest: raw.to_string(),
            };
            replace_text(
                &root,
                &relative,
                &serde_json::to_string(&backup).map_err(|e| e.to_string())?,
            )?;
        } else {
            let relative = format!(
                "{BACKUPS}/damaged-{micros:020}-{}.bin",
                uuid::Uuid::new_v4()
            );
            replace_bytes(&root, &relative, text)?;
        }
        sync_directory(&root.join(BACKUPS))?;
        hook(SavePhase::BackupWritten)?;
    }
    sync_directory(&root.join(".feather"))?;
    let next = serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?;
    // Re-check after staging to detect external editors that do not take our OS lock.
    if current_bytes(&root)? != old {
        return Err("This project changed on disk while saving. Reopen it or use Save as to keep your edits.".into());
    }
    hook(SavePhase::BeforeCommit)?;
    replace_text(&root, "project.json", &next)?;
    hook(SavePhase::Committed)?;
    let mut warnings = Vec::new();
    if let Err(error) = sync_directory(&root) {
        warnings.push(error);
    }
    if let Err(error) = prune(&root, &manifest) {
        warnings.push(format!(
            "Saved successfully; previous-save cleanup could not finish: {error}"
        ));
    }
    Ok(SaveResult {
        revision: checksum(next.as_bytes()),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    struct Project(PathBuf);
    impl Project {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("feather-save-test-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&dir).unwrap();
            Self(dir)
        }
    }
    impl Drop for Project {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn input(label: &str) -> (String, Vec<String>) {
        (
            json!({"name": label, "version": "0.8.0", "activeSceneId": "a", "scenes": [
                {"id": "a", "name": "A", "file": "scenes/a.scene.json"},
                {"id": "b", "name": "B", "file": "scenes/b.scene.json"}
            ]})
            .to_string(),
            vec![
                json!({"id": "a", "name": "A", "objects": [{"name":label}]}).to_string(),
                json!({"id": "b", "name": "B", "objects": [{"name":label}]}).to_string(),
            ],
        )
    }
    fn assert_label(project: &Project, label: &str) {
        let loaded = read_project(&project.0, false).unwrap();
        assert_eq!(loaded.manifest["name"], label);
        for scene in loaded.scenes {
            assert_eq!(scene["objects"][0]["name"], label);
        }
    }
    #[test]
    fn saves_and_reopens_complete_snapshots_and_previous_versions() {
        let dir = Project::new();
        let (a, scenes) = input("old");
        let old = save_project(&dir.0, &a, &scenes, None).unwrap();
        assert_label(&dir, "old");
        let (b, scenes) = input("new");
        save_project(&dir.0, &b, &scenes, Some(&old.revision)).unwrap();
        assert_label(&dir, "new");
        let previous = read_project(&dir.0, true).unwrap();
        assert_eq!(previous.manifest["name"], "old");
        assert!(previous.recovered_from.is_some());
    }
    #[test]
    fn interruption_at_every_publish_phase_exposes_one_complete_version() {
        for phase in [
            SavePhase::SceneWritten,
            SavePhase::BackupWritten,
            SavePhase::BeforeCommit,
            SavePhase::Committed,
        ] {
            let dir = Project::new();
            let (a, scenes) = input("old");
            let old = save_project(&dir.0, &a, &scenes, None).unwrap();
            let (b, scenes) = input("new");
            let result = save_with_hook(&dir.0, &b, &scenes, Some(&old.revision), |at| {
                if at == phase {
                    Err("simulated process interruption".into())
                } else {
                    Ok(())
                }
            });
            assert!(result.is_err());
            assert_label(
                &dir,
                if phase == SavePhase::Committed {
                    "new"
                } else {
                    "old"
                },
            );
        }
    }
    #[test]
    fn retries_interrupted_first_saves_and_reuses_unchanged_scenes() {
        let dir = Project::new();
        let (manifest, scenes) = input("same");
        assert!(save_with_hook(&dir.0, &manifest, &scenes, None, |at| {
            if at == SavePhase::SceneWritten {
                Err("stop".into())
            } else {
                Ok(())
            }
        })
        .is_err());
        let result = save_project(&dir.0, &manifest, &scenes, None).unwrap();
        save_project(&dir.0, &manifest, &scenes, Some(&result.revision)).unwrap();
        assert_eq!(fs::read_dir(dir.0.join(SCENE_STORAGE)).unwrap().count(), 2);
        assert_label(&dir, "same");
    }
    #[test]
    fn recovers_damaged_current_manifest_or_scene_without_overwriting_them() {
        for damage_scene in [false, true] {
            let dir = Project::new();
            let (a, scenes) = input("old");
            let old = save_project(&dir.0, &a, &scenes, None).unwrap();
            let (b, scenes) = input("new");
            save_project(&dir.0, &b, &scenes, Some(&old.revision)).unwrap();
            let target = if damage_scene {
                let loaded = read_project(&dir.0, false).unwrap();
                dir.0
                    .join(loaded.manifest["scenes"][0]["file"].as_str().unwrap())
            } else {
                dir.0.join("project.json")
            };
            fs::write(&target, "damaged").unwrap();
            let recovered = read_project(&dir.0, false).unwrap();
            assert_eq!(recovered.manifest["name"], "old");
            assert!(recovered.recovered_from.is_some());
            assert_eq!(fs::read_to_string(target).unwrap(), "damaged");
        }
    }
    #[test]
    fn recovers_invalid_utf8_and_retains_damaged_manifest_on_explicit_resave() {
        let dir = Project::new();
        let (a, scenes) = input("old");
        let old = save_project(&dir.0, &a, &scenes, None).unwrap();
        let (b, scenes) = input("new");
        save_project(&dir.0, &b, &scenes, Some(&old.revision)).unwrap();
        let damaged = vec![0xff, 0xfe, 0x00];
        fs::write(dir.0.join("project.json"), &damaged).unwrap();
        let recovered = read_project(&dir.0, false).unwrap();
        assert_eq!(recovered.manifest["name"], "old");
        let (next, scenes) = input("repaired");
        save_project(&dir.0, &next, &scenes, recovered.revision.as_deref()).unwrap();
        assert_label(&dir, "repaired");
        let original = fs::read_dir(dir.0.join(BACKUPS))
            .unwrap()
            .flatten()
            .find(|entry| entry.file_name().to_string_lossy().starts_with("damaged-"))
            .unwrap();
        assert_eq!(fs::read(original.path()).unwrap(), damaged);
    }
    #[test]
    fn backup_write_failure_preserves_the_current_complete_save() {
        let dir = Project::new();
        let (a, scenes) = input("old");
        let old = save_project(&dir.0, &a, &scenes, None).unwrap();
        fs::write(dir.0.join(BACKUPS), "not a directory").unwrap();
        let (next, scenes) = input("new");
        assert!(save_project(&dir.0, &next, &scenes, Some(&old.revision)).is_err());
        assert_label(&dir, "old");
    }
    #[test]
    fn concurrent_saves_with_the_same_checkpoint_only_publish_once() {
        let dir = Project::new();
        let (a, scenes) = input("old");
        let old = save_project(&dir.0, &a, &scenes, None).unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let workers: Vec<_> = ["left", "right"]
            .into_iter()
            .map(|label| {
                let barrier = barrier.clone();
                let path = dir.0.clone();
                let revision = old.revision.clone();
                std::thread::spawn(move || {
                    let (manifest, scenes) = input(label);
                    barrier.wait();
                    save_project(&path, &manifest, &scenes, Some(&revision))
                })
            })
            .collect();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let loaded = read_project(&dir.0, false).unwrap();
        assert_label(&dir, loaded.manifest["name"].as_str().unwrap());
    }
    #[test]
    fn detects_valid_json_scene_corruption_by_checksum() {
        let dir = Project::new();
        let (manifest, scenes) = input("original");
        save_project(&dir.0, &manifest, &scenes, None).unwrap();
        let loaded = read_project(&dir.0, false).unwrap();
        fs::write(
            dir.0
                .join(loaded.manifest["scenes"][0]["file"].as_str().unwrap()),
            json!({"id":"a", "objects":[]}).to_string(),
        )
        .unwrap();
        assert!(read_project(&dir.0, false)
            .unwrap_err()
            .contains("integrity"));
    }
    #[test]
    fn recovers_corrupt_shared_containers_and_skips_damaged_backups() {
        let dir = Project::new();
        let mut revision = None;
        for label in ["first", "second", "third"] {
            let (manifest, scenes) = input(label);
            revision = Some(
                save_project(&dir.0, &manifest, &scenes, revision.as_deref())
                    .unwrap()
                    .revision,
            );
        }
        let mut current: Value =
            serde_json::from_slice(&fs::read(dir.0.join("project.json")).unwrap()).unwrap();
        current["assets"] = json!({"damaged": true});
        fs::write(dir.0.join("project.json"), current.to_string()).unwrap();
        assert_label(&dir, "second");
        let newest = backup_files(&dir.0).unwrap().remove(0);
        fs::write(dir.0.join(newest), "damaged backup").unwrap();
        assert_label(&dir, "first");
    }
    #[test]
    fn rotates_three_backups_and_keeps_all_their_scene_dependencies() {
        let dir = Project::new();
        let mut revision = None;
        for i in 0..8 {
            let (manifest, scenes) = input(&i.to_string());
            revision = Some(
                save_project(&dir.0, &manifest, &scenes, revision.as_deref())
                    .unwrap()
                    .revision,
            );
        }
        let files = backup_files(&dir.0).unwrap();
        assert_eq!(files.len(), BACKUP_COUNT);
        for path in files {
            read_snapshot(&dir.0, &read_backup(&dir.0, &path).unwrap()).unwrap();
        }
        assert_eq!(fs::read_dir(dir.0.join(SCENE_STORAGE)).unwrap().count(), 8);
        assert_label(&dir, "7");
    }
    #[test]
    fn stale_saves_and_newer_formats_cannot_overwrite_the_current_project() {
        let dir = Project::new();
        let (a, scenes) = input("old");
        let first = save_project(&dir.0, &a, &scenes, None).unwrap();
        let (b, scenes) = input("new");
        let second = save_project(&dir.0, &b, &scenes, Some(&first.revision)).unwrap();
        assert!(save_project(&dir.0, &a, &scenes, Some(&first.revision)).is_err());
        assert_label(&dir, "new");
        let mut future: Value = serde_json::from_str(&b).unwrap();
        future["version"] = json!("99.0.0");
        let future =
            save_project(&dir.0, &future.to_string(), &scenes, Some(&second.revision)).unwrap();
        assert!(save_project(&dir.0, &b, &scenes, Some(&future.revision))
            .unwrap_err()
            .contains("newer"));
    }
    #[test]
    fn legacy_manifest_and_fixed_scene_files_remain_readable_and_unchanged() {
        let dir = Project::new();
        let (manifest, scenes) = input("legacy");
        fs::create_dir(dir.0.join("scenes")).unwrap();
        fs::write(dir.0.join("project.json"), &manifest).unwrap();
        for (id, text) in ["a", "b"].iter().zip(scenes.iter()) {
            fs::write(dir.0.join(format!("scenes/{id}.scene.json")), text).unwrap();
        }
        let previous = read_project(&dir.0, false).unwrap();
        let (next, new_scenes) = input("new");
        save_project(&dir.0, &next, &new_scenes, previous.revision.as_deref()).unwrap();
        assert_eq!(
            read_project(&dir.0, true).unwrap().manifest["name"],
            "legacy"
        );
        assert_eq!(
            fs::read_to_string(dir.0.join("scenes/a.scene.json")).unwrap(),
            scenes[0]
        );
    }
    #[test]
    fn unsafe_or_duplicate_inputs_fail_before_publishing_a_manifest() {
        let dir = Project::new();
        let (manifest, scenes) = input("safe");
        let mut bad: Value = serde_json::from_str(&manifest).unwrap();
        bad["scenes"][0]["file"] = json!("../outside.json");
        assert!(save_project(&dir.0, &bad.to_string(), &scenes, None).is_err());
        bad["scenes"][0]["file"] = json!("scenes/../outside.json");
        assert!(save_project(&dir.0, &bad.to_string(), &scenes, None).is_err());
        assert!(!dir.0.join("project.json").exists());
        assert!(save_project(
            &dir.0,
            &manifest,
            &[scenes[0].clone(), scenes[0].clone()],
            None
        )
        .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_scene_storage() {
        let dir = Project::new();
        let outside = Project::new();
        fs::create_dir(dir.0.join("scenes")).unwrap();
        std::os::unix::fs::symlink(&outside.0, dir.0.join(SCENE_STORAGE)).unwrap();
        let (manifest, scenes) = input("safe");
        assert!(save_project(&dir.0, &manifest, &scenes, None).is_err());
        assert!(!dir.0.join("project.json").exists());
        assert_eq!(fs::read_dir(&outside.0).unwrap().count(), 0);
    }
}
