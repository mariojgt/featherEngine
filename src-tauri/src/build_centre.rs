//! GitHub CLI bridge. Credentials stay with gh; no shell commands or tokens enter the webview.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};
const WORKFLOW: &str = "feather-build-centre.yml";
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    action: String,
    repository: String,
    #[serde(rename = "ref")]
    git_ref: String,
    request_id: Option<String>,
    run_id: Option<u64>,
    bundle_json: Option<String>,
    expected_commit: Option<String>,
    directory: Option<String>,
}
fn validate(request: &Request) -> Result<(), String> {
    let parts: Vec<_> = request.repository.split('/').collect();
    if parts.len() != 2
        || parts.iter().any(|part| {
            part.is_empty()
                || !part.as_bytes()[0].is_ascii_alphanumeric()
                || !part
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        })
    {
        return Err("Use a GitHub repository in owner/name form.".into());
    }
    let r = &request.git_ref;
    if r.is_empty()
        || r.len() > 200
        || r.starts_with('-')
        || r.contains("..")
        || r.contains("@{")
        || r.bytes()
            .any(|c| !c.is_ascii_alphanumeric() && !b"_./-".contains(&c))
    {
        return Err("Invalid Git branch or tag.".into());
    }
    if request.action != "check"
        && !request
            .request_id
            .as_ref()
            .map(|id| {
                id.len() == 32
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
            .unwrap_or(false)
    {
        return Err("Invalid build request id.".into());
    }
    Ok(())
}
#[cfg(test)]
thread_local! { static MOCK_GH: std::cell::RefCell<Option<std::collections::VecDeque<(String, Result<String, String>)>>> = const { std::cell::RefCell::new(None) }; }
fn gh(args: &[&str], seconds: u64) -> Result<String, String> {
    #[cfg(test)]
    if let Some(reply) = MOCK_GH.with(|mock| {
        let mut mock = mock.borrow_mut();
        mock.as_mut().map(|queue| {
            let (prefix, reply) = queue.pop_front().expect("Unexpected GitHub command");
            assert!(
                args.join(" ").starts_with(&prefix),
                "Expected {prefix}, got {args:?}"
            );
            reply
        })
    }) {
        return reply;
    }
    // Drain both pipes concurrently; a verbose command must never deadlock on a full stderr pipe.
    let executable = if cfg!(target_os = "macos") {
        ["/opt/homebrew/bin/gh", "/usr/local/bin/gh"]
            .into_iter()
            .find(|p| Path::new(p).is_file())
            .unwrap_or("gh")
    } else {
        "gh"
    };
    let mut child = Command::new(executable).args(args).env("GH_PROMPT_DISABLED", "1").env("GH_HOST", "github.com").env("NO_COLOR", "1").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|e| format!("GitHub CLI could not start: {e}. Install gh, then run gh auth login in a terminal."))?;
    fn drain(mut pipe: impl Read) -> Vec<u8> {
        let mut out = Vec::new();
        let mut chunk = [0; 8192];
        while let Ok(n) = pipe.read(&mut chunk) {
            if n == 0 {
                break;
            }
            if out.len() < 4 * 1024 * 1024 {
                out.extend_from_slice(&chunk[..n]);
            }
        }
        out
    }
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let out = thread::spawn(move || drain(stdout));
    let err = thread::spawn(move || drain(stderr));
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Ok(None) => {}
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
        if start.elapsed() > Duration::from_secs(seconds) {
            let _ = child.kill();
            let _ = child.wait();
            break Err(
                "GitHub command timed out. Refresh build status before trying again.".into(),
            );
        }
        thread::sleep(Duration::from_millis(100));
    };
    let output = String::from_utf8_lossy(&out.join().unwrap_or_default()).to_string();
    let error = String::from_utf8_lossy(&err.join().unwrap_or_default()).to_string();
    if !status?.success() {
        return Err(format!(
            "GitHub: {}",
            error.chars().take(1800).collect::<String>()
        ));
    }
    Ok(output)
}
fn api(path: &str) -> Result<Value, String> {
    serde_json::from_str(&gh(&["api", path], 60)?)
        .map_err(|e| format!("Invalid GitHub response: {e}"))
}
fn encoded(value: &str) -> String {
    value
        .bytes()
        .map(|c| {
            if c.is_ascii_alphanumeric() || b"-_.~".contains(&c) {
                (c as char).to_string()
            } else {
                format!("%{c:02X}")
            }
        })
        .collect()
}
fn check(request: &Request) -> Result<Value, String> {
    let repo = &request.repository;
    let info = api(&format!("repos/{repo}"))?;
    if info["permissions"]["push"] != true {
        return Err("This GitHub account needs write access to the selected repository.".into());
    }
    let commit = api(&format!(
        "repos/{repo}/commits/{}",
        encoded(&request.git_ref)
    ))?["sha"]
        .as_str()
        .ok_or("Could not resolve the engine revision")?
        .to_owned();
    let workflow = api(&format!(
        "repos/{repo}/contents/.github/workflows/{WORKFLOW}?ref={commit}"
    ))?;
    use base64::Engine;
    let contents = base64::engine::general_purpose::STANDARD
        .decode(workflow["content"].as_str().unwrap_or("").replace('\n', ""))
        .map_err(|_| "Could not read the Build Centre workflow")?;
    if !String::from_utf8_lossy(&contents).contains("# feather-build-centre-protocol: 1") {
        return Err("Commit Feather's Build Centre workflow and scripts to this branch first. The workflow must also exist on the repository's default branch.".into());
    }
    let enabled = api(&format!("repos/{repo}/actions/workflows/{WORKFLOW}"))?;
    if enabled["state"] != "active" {
        return Err("Enable the Feather Build Centre workflow in GitHub Actions first.".into());
    }
    Ok(json!({ "repository": info["full_name"], "private": info["private"], "commit": commit }))
}
fn find_run(request: &Request) -> Result<Option<Value>, String> {
    let title = format!(
        "Feather build {}",
        request.request_id.as_deref().unwrap_or("")
    );
    if let Some(id) = request.run_id {
        let run = api(&format!("repos/{}/actions/runs/{id}", request.repository))?;
        if run["display_title"] != title || run["path"] != format!(".github/workflows/{WORKFLOW}") {
            return Err(
                "This workflow run does not belong to the selected Build Centre request.".into(),
            );
        }
        return Ok(Some(run));
    }
    // Jobs remain findable after reload; do not confuse a different project's run with this one.
    for page in 1..=5 {
        let runs = api(&format!("repos/{}/actions/workflows/{WORKFLOW}/runs?event=workflow_dispatch&per_page=100&page={page}", request.repository))?;
        let items = runs["workflow_runs"]
            .as_array()
            .ok_or("Missing workflow runs")?;
        if let Some(run) = items.iter().find(|run| run["display_title"] == title) {
            return Ok(Some(run.clone()));
        }
        if items.len() < 100 {
            break;
        }
    }
    Ok(None)
}
fn owned_release(request: &Request, tag: &str) -> Result<Value, String> {
    let release = api(&format!("repos/{}/releases/tags/{tag}", request.repository))?;
    if release["draft"] != true
        || !release["body"].as_str().unwrap_or("").contains(&format!(
            "Feather Build Centre input\nRequest: {}\n",
            request.request_id.as_deref().unwrap_or("")
        ))
    {
        return Err(
            "This release is not a draft input package owned by this build request.".into(),
        );
    }
    Ok(release)
}
fn execute(request: Request) -> Result<Value, String> {
    validate(&request)?;
    if request.action == "check" {
        return check(&request);
    }
    let repo = &request.repository;
    let request_id = request.request_id.as_deref().unwrap();
    let tag = format!("feather-build-{request_id}");
    if request.action == "start" {
        let verified = check(&request)?;
        if verified["commit"].as_str() != request.expected_commit.as_deref() {
            return Err("The engine branch changed since review. Check the repository and prepare the build again.".into());
        }
        let bundle = request
            .bundle_json
            .as_deref()
            .ok_or("Missing reviewed game package")?;
        if bundle.len() > 512 * 1024 * 1024 {
            return Err("Game package exceeds the 512 MB Build Centre upload limit.".into());
        }
        let value: Value = serde_json::from_str(bundle).map_err(|_| "Invalid game package JSON")?;
        if value["bundleVersion"].as_str().is_none()
            || !value["project"]["scenes"].is_array()
            || value["runtimeContract"].is_null()
        {
            return Err("Missing game bundle or runtime contract.".into());
        }
        let temp = super::create_scoped_temp_dir("feather-cloud-build")?;
        let file = temp.0.join("game.json");
        fs::write(&file, bundle).map_err(|e| e.to_string())?;
        let hash = format!("{:x}", Sha256::digest(bundle.as_bytes()));
        let notes = temp.0.join("notes.txt");
        fs::write(&notes, format!("Feather Build Centre input\nRequest: {request_id}\nSHA256: {hash}\nDelete this draft from Build Centre when retries are no longer needed.")).map_err(|e| e.to_string())?;
        let commit = verified["commit"].as_str().unwrap();
        gh(
            &[
                "release",
                "create",
                &tag,
                "--repo",
                repo,
                "--target",
                commit,
                "--draft",
                "--title",
                &format!("Feather build input {request_id}"),
                "--notes-file",
                notes.to_str().ok_or("Invalid staging path")?,
            ],
            120,
        )?;
        gh(
            &[
                "release",
                "upload",
                &tag,
                file.to_str().ok_or("Invalid staging path")?,
                "--repo",
                repo,
            ],
            600,
        )?;
        gh(
            &[
                "workflow",
                "run",
                WORKFLOW,
                "--repo",
                repo,
                "--ref",
                &request.git_ref,
                "-f",
                &format!("request_id={request_id}"),
                "-f",
                &format!("bundle_sha256={hash}"),
                "-f",
                &format!("engine_sha={commit}"),
            ],
            120,
        )?;
        return Ok(
            json!({ "message": "Build requested. GitHub may take a moment to create the run." }),
        );
    }
    let run = find_run(&request)?;
    if request.action == "cleanup" {
        if run.is_none() {
            return Err("No run is visible yet. Refresh before cleanup. If setup failed before dispatch, inspect and remove the draft in GitHub Releases.".into());
        }
        if run.as_ref().is_some_and(|r| r["status"] != "completed") {
            return Err("Wait for the build to finish before removing its input package.".into());
        }
        owned_release(&request, &tag)?;
        gh(&["release", "delete", &tag, "--repo", repo, "--yes"], 60)?;
        return Ok(
            json!({"message": "Uploaded draft input package removed. Existing workflow artifacts remain available."}),
        );
    }
    let Some(run) = run else {
        return Ok(
            json!({ "message": "Waiting for GitHub to register the run. If dispatch failed, remove the input package and prepare a new build." }),
        );
    };
    let id = run["id"]
        .as_u64()
        .ok_or("Invalid workflow run id")?
        .to_string();
    if request.action == "cancel" || request.action == "retry" {
        if request.action == "retry" {
            owned_release(&request, &tag)?;
            if run["status"] != "completed" {
                return Err("Wait for the current run to finish before retrying.".into());
            }
        }
        gh(
            &[
                "run",
                if request.action == "cancel" {
                    "cancel"
                } else {
                    "rerun"
                },
                &id,
                "--repo",
                repo,
            ],
            60,
        )?;
        return Ok(json!({"message": "Request sent. Refresh to see the updated run."}));
    }
    if request.action == "download" {
        let directory = request
            .directory
            .as_deref()
            .ok_or("Choose a download directory")?;
        if !Path::new(directory).is_absolute() {
            return Err("Download directory must be absolute.".into());
        }
        let destination = Path::new(directory).join(format!(
            "feather-build-{request_id}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        fs::create_dir(&destination)
            .map_err(|e| format!("Cannot create a new download folder: {e}"))?;
        gh(
            &[
                "run",
                "download",
                &id,
                "--repo",
                repo,
                "--dir",
                destination.to_str().ok_or("Invalid download path")?,
            ],
            600,
        )?;
        return Ok(json!({ "directory": destination }));
    }
    if request.action != "status" {
        return Err("Unknown Build Centre action.".into());
    }
    let jobs = api(&format!("repos/{repo}/actions/runs/{id}/jobs?per_page=100"))?;
    let artifacts = api(&format!(
        "repos/{repo}/actions/runs/{id}/artifacts?per_page=100"
    ))?;
    let empty = vec![];
    Ok(
        json!({ "run": { "id": run["id"], "status": run["status"], "conclusion": run["conclusion"], "url": run["html_url"], "commit": run["head_sha"],
        "jobs": jobs["jobs"].as_array().unwrap_or(&empty).iter().map(|job| json!({ "name": job["name"], "status": job["status"], "conclusion": job["conclusion"], "steps": job["steps"] })).collect::<Vec<_>>(),
        "artifacts": artifacts["artifacts"].as_array().unwrap_or(&empty).iter().map(|a| json!({ "name": a["name"], "size": a["size_in_bytes"], "expired": a["expired"] })).collect::<Vec<_>>()
    } }),
    )
}
#[tauri::command]
pub async fn cloud_build(request: Request) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || execute(request))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn request(repo: &str, reference: &str, id: &str) -> Request {
        Request {
            action: "status".into(),
            repository: repo.into(),
            git_ref: reference.into(),
            request_id: Some(id.into()),
            run_id: None,
            bundle_json: None,
            expected_commit: None,
            directory: None,
        }
    }
    #[test]
    fn validates_identifiers_before_starting_processes() {
        let id = "0123456789abcdef0123456789abcdef";
        assert!(validate(&request("owner/game", "release/v1", id)).is_ok());
        for repo in ["--help", "a/b/c", "a/../../x", "a/b?evil", "a/b\n"] {
            assert!(validate(&request(repo, "main", id)).is_err());
        }
        for reference in ["-main", "a..b", "main\n", "$(command)", "a?x"] {
            assert!(validate(&request("a/b", reference, id)).is_err());
        }
        assert!(validate(&request("a/b", "main", "../../../release")).is_err());
        assert_eq!(encoded("release/v1"), "release%2Fv1");
    }
    fn mock(responses: Vec<(&str, Value)>) {
        MOCK_GH.with(|m| {
            *m.borrow_mut() = Some(
                responses
                    .into_iter()
                    .map(|(prefix, value)| (prefix.to_string(), Ok(value.to_string())))
                    .collect(),
            )
        });
    }
    fn run(status: &str) -> Value {
        json!({"id": 123, "display_title": "Feather build 0123456789abcdef0123456789abcdef", "status": status, "conclusion": null, "head_sha": "abc", "html_url": "https://github.com/owner/game/actions/runs/123"})
    }
    #[test]
    fn finds_only_the_requested_run_and_keeps_launch_evidence() {
        let req = request("owner/game", "main", "0123456789abcdef0123456789abcdef");
        mock(vec![
            (
                "api repos/owner/game/actions/workflows/feather-build-centre.yml/runs",
                json!({"workflow_runs": [{"id": 999, "display_title": "another project"}, run("completed")]}),
            ),
            (
                "api repos/owner/game/actions/runs/123/jobs",
                json!({"jobs": [{"name": "macos", "status": "completed", "conclusion": "success", "steps": [{"name": "Launch game", "conclusion": "success"}]}]}),
            ),
            (
                "api repos/owner/game/actions/runs/123/artifacts",
                json!({"artifacts": [{"name": "game-macos", "size_in_bytes": 10, "expired": false}]}),
            ),
        ]);
        let result = execute(req).unwrap();
        assert_eq!(result["run"]["id"], 123);
        assert_eq!(
            result["run"]["jobs"][0]["steps"][0]["conclusion"],
            "success"
        );
        assert_eq!(result["run"]["artifacts"][0]["size"], 10);
    }
    #[test]
    fn cleanup_refuses_active_or_unregistered_runs_and_unowned_releases() {
        let id = "0123456789abcdef0123456789abcdef";
        for status in [Some("in_progress"), None] {
            let mut req = request("owner/game", "main", id);
            req.action = "cleanup".into();
            mock(vec![(
                "api repos/owner/game/actions/workflows/",
                json!({"workflow_runs": status.map(|s| vec![run(s)]).unwrap_or_default()}),
            )]);
            assert!(execute(req).is_err());
        }
        let mut req = request("owner/game", "main", id);
        req.action = "cleanup".into();
        mock(vec![
            (
                "api repos/owner/game/actions/workflows/",
                json!({"workflow_runs": [run("completed")]}),
            ),
            (
                "api repos/owner/game/releases/tags/",
                json!({"draft": false, "body": "unrelated release"}),
            ),
        ]);
        assert!(execute(req).unwrap_err().contains("owned"));
    }
    #[test]
    fn changed_engine_revision_blocks_before_any_upload() {
        use base64::Engine;
        let mut req = request("owner/game", "main", "0123456789abcdef0123456789abcdef");
        req.action = "start".into();
        req.expected_commit = Some("old".into());
        mock(vec![
            (
                "api repos/owner/game",
                json!({"full_name": "owner/game", "private": true, "permissions": {"push": true}}),
            ),
            ("api repos/owner/game/commits/main", json!({"sha": "new"})),
            (
                "api repos/owner/game/contents/",
                json!({"content": base64::engine::general_purpose::STANDARD.encode("# feather-build-centre-protocol: 1")}),
            ),
            (
                "api repos/owner/game/actions/workflows/",
                json!({"state": "active"}),
            ),
        ]);
        assert!(execute(req).unwrap_err().contains("changed since review"));
        MOCK_GH.with(|m| assert!(m.borrow().as_ref().unwrap().is_empty()));
    }
}
