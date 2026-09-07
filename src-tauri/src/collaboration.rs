use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::ws::{close_code, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use base64::engine::general_purpose::{STANDARD as BASE64, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::{SinkExt, StreamExt, TryStreamExt};
use ngrok::prelude::{EndpointInfo, ForwarderBuilder, TunnelCloser};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tauri::{AppHandle, State as TauriState};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::{mpsc, Semaphore};
use tokio::task::JoinHandle;
use tokio::time::{interval, timeout};
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const PROTOCOL_VERSION: u8 = 1;
const MAX_PARTICIPANTS: usize = 32;
const MAX_PENDING_CONNECTIONS: usize = 64;
const MAX_SYNC_UPDATE_BYTES: usize = 32 * 1024 * 1024;
const MAX_WS_MESSAGE_BYTES: usize = MAX_SYNC_UPDATE_BYTES * 4 / 3 + 4096;
const MAX_PRESENCE_BYTES: usize = 32 * 1024;
const MAX_RATE_WINDOW_BYTES: u64 = 64 * 1024 * 1024;
// Edit-mode transform projection runs at roughly 31 Hz and presence at up to 10 Hz. Keep enough
// headroom for normal dragging plus sync/control frames while the byte budget remains the primary
// protection against large-message abuse.
const MAX_MESSAGES_PER_RATE_WINDOW: u32 = 900;
const MAX_ASSET_BYTES: u64 = 512 * 1024 * 1024;
const MAX_REGISTERED_ASSETS: usize = 4096;
const OUTBOUND_QUEUE_CAPACITY: usize = 256;
const ASSET_RATE_WINDOW: Duration = Duration::from_secs(10 * 60);
const MAX_CLIENT_ASSET_REQUESTS: u32 = 512;
const MAX_CLIENT_ASSET_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_SESSION_ASSET_REQUESTS: u32 = 2048;
const MAX_SESSION_ASSET_BYTES: u64 = 8 * 1024 * 1024 * 1024;
const MAX_CLIENT_ASSET_CONCURRENCY: usize = 2;
const MAX_SESSION_ASSET_CONCURRENCY: usize = 8;
const AUTH_TIMEOUT: Duration = Duration::from_secs(10);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(15);
const HEARTBEAT_TIMEOUT: Duration = Duration::from_secs(45);
const TUNNEL_STARTUP_STABILITY: Duration = Duration::from_millis(250);
const CLOSE_REASON_SESSION_ENDED: &str = "Session ended";
const CLOSE_REASON_TUNNEL_UNAVAILABLE: &str = "Ngrok tunnel unavailable";
const CLOSE_REASON_RELAY_UNAVAILABLE: &str = "Local relay unavailable";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RelayShutdownReason {
    SessionEnded,
    TunnelUnavailable,
    RelayUnavailable,
}

impl RelayShutdownReason {
    fn close_reason(self) -> &'static str {
        match self {
            Self::SessionEnded => CLOSE_REASON_SESSION_ENDED,
            Self::TunnelUnavailable => CLOSE_REASON_TUNNEL_UNAVAILABLE,
            Self::RelayUnavailable => CLOSE_REASON_RELAY_UNAVAILABLE,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum CollaborationRole {
    Host,
    Editor,
    Viewer,
}

impl CollaborationRole {
    fn can_edit(self) -> bool {
        matches!(self, Self::Host | Self::Editor)
    }

    fn is_host(self) -> bool {
        self == Self::Host
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Participant {
    id: String,
    #[serde(skip_serializing)]
    client_id: String,
    name: String,
    role: CollaborationRole,
}

#[derive(Clone)]
struct ParticipantEntry {
    public: Participant,
    outbound: mpsc::Sender<Message>,
    asset_token_hash: [u8; 32],
    asset_rate_limit: Arc<Mutex<AssetDownloadLimit>>,
    asset_concurrency: Arc<Semaphore>,
}

#[derive(Clone)]
struct AssetAccess {
    rate_limit: Arc<Mutex<AssetDownloadLimit>>,
    concurrency: Arc<Semaphore>,
}

#[derive(Clone)]
struct RegisteredAsset {
    path: PathBuf,
    project_root: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    content_type: String,
}

#[derive(Clone)]
struct CredentialHashes {
    salt: [u8; 32],
    host: [u8; 32],
    join: [u8; 32],
}

impl CredentialHashes {
    fn new(host_secret: &str, join_secret: &str) -> Self {
        let mut salt = [0_u8; 32];
        OsRng.fill_bytes(&mut salt);
        Self {
            salt,
            host: hash_credential(&salt, host_secret),
            join: hash_credential(&salt, join_secret),
        }
    }

    fn authenticate(
        &self,
        credential: &str,
        default_role: CollaborationRole,
    ) -> Option<CollaborationRole> {
        let candidate = hash_credential(&self.salt, credential);
        let host_matches = self.host.ct_eq(&candidate).unwrap_u8();
        let join_matches = self.join.ct_eq(&candidate).unwrap_u8();
        if host_matches == 1 {
            Some(CollaborationRole::Host)
        } else if join_matches == 1 {
            Some(default_role)
        } else {
            None
        }
    }
}

fn hash_credential(salt: &[u8; 32], credential: &str) -> [u8; 32] {
    let mut digest = Sha256::new();
    digest.update(salt);
    digest.update(credential.as_bytes());
    digest.finalize().into()
}

fn hash_asset_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

fn random_asset_token() -> String {
    let mut bytes = [0_u8; 32];
    OsRng.fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

struct AssetDownloadLimit {
    window: Instant,
    requests: u32,
    bytes: u64,
}

impl AssetDownloadLimit {
    fn new() -> Self {
        Self {
            window: Instant::now(),
            requests: 0,
            bytes: 0,
        }
    }

    fn refresh(&mut self, now: Instant) {
        if now.duration_since(self.window) >= ASSET_RATE_WINDOW {
            self.window = now;
            self.requests = 0;
            self.bytes = 0;
        }
    }

    fn can_accept_request(&self, max_requests: u32) -> bool {
        self.requests < max_requests
    }

    fn can_accept_bytes(&self, bytes: u64, max_bytes: u64) -> bool {
        self.bytes.saturating_add(bytes) <= max_bytes
    }

    fn reserve_request(&mut self) {
        self.requests = self.requests.saturating_add(1);
    }

    fn reserve_bytes(&mut self, bytes: u64) {
        self.bytes = self.bytes.saturating_add(bytes);
    }
}

struct RelayState {
    session_id: String,
    credentials: CredentialHashes,
    default_role: CollaborationRole,
    participants: RwLock<HashMap<String, ParticipantEntry>>,
    kicked_clients: RwLock<HashSet<String>>,
    assets: RwLock<HashMap<String, RegisteredAsset>>,
    asset_rate_limit: Mutex<AssetDownloadLimit>,
    asset_concurrency: Arc<Semaphore>,
    pending_connections: AtomicUsize,
    cancellation: CancellationToken,
    shutdown_reason: RwLock<RelayShutdownReason>,
}

impl RelayState {
    fn shutdown_reason(&self) -> RelayShutdownReason {
        *self
            .shutdown_reason
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn set_shutdown_reason(&self, reason: RelayShutdownReason) {
        *self
            .shutdown_reason
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = reason;
    }

    fn roster(&self) -> Vec<Participant> {
        let mut participants: Vec<_> = self
            .participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .map(|entry| entry.public.clone())
            .collect();
        participants.sort_by(|left, right| left.id.cmp(&right.id));
        participants
    }

    fn role_for(&self, participant_id: &str) -> Option<CollaborationRole> {
        self.participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(participant_id)
            .map(|entry| entry.public.role)
    }

    fn outbound_for(&self, participant_id: &str) -> Option<mpsc::Sender<Message>> {
        self.participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(participant_id)
            .map(|entry| entry.outbound.clone())
    }

    fn asset_access_for(&self, credential: &str) -> Option<AssetAccess> {
        if credential.len() < 32 || credential.len() > 128 {
            return None;
        }
        let candidate = hash_asset_token(credential);
        self.participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .find(|entry| entry.asset_token_hash.ct_eq(&candidate).unwrap_u8() == 1)
            .map(|entry| AssetAccess {
                rate_limit: entry.asset_rate_limit.clone(),
                concurrency: entry.asset_concurrency.clone(),
            })
    }

    fn broadcast(&self, message: Message, except: Option<&str>) {
        let recipients: Vec<_> = self
            .participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .iter()
            .filter(|(id, _)| except != Some(id.as_str()))
            .map(|(id, entry)| (id.clone(), entry.outbound.clone()))
            .collect();
        let failed: Vec<_> = recipients
            .into_iter()
            .filter_map(|(id, recipient)| recipient.try_send(message.clone()).err().map(|_| id))
            .collect();
        if failed.is_empty() {
            return;
        }

        // A full outbound queue means that peer can no longer keep up with the authoritative
        // stream. Drop it instead of silently losing an arbitrary subset of CRDT updates; the
        // client reconnects and performs a complete Yjs state merge.
        {
            let mut participants = self
                .participants
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for participant_id in &failed {
                participants.remove(participant_id);
            }
        }
        let roster = json_message(json!({
          "v": PROTOCOL_VERSION,
          "type": "roster",
          "participants": self.roster(),
        }));
        let remaining: Vec<_> = self
            .participants
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .map(|entry| entry.outbound.clone())
            .collect();
        for recipient in remaining {
            let _ = recipient.try_send(roster.clone());
        }
    }

    fn broadcast_roster(&self) {
        self.broadcast(
            json_message(json!({
              "v": PROTOCOL_VERSION,
              "type": "roster",
              "participants": self.roster(),
            })),
            None,
        );
    }

    fn send_error(&self, participant_id: &str, code: &str, message: &str) {
        if let Some(outbound) = self.outbound_for(participant_id) {
            let _ = outbound.try_send(error_message(code, message));
        }
    }
}

struct PendingConnectionGuard {
    state: Arc<RelayState>,
}

impl Drop for PendingConnectionGuard {
    fn drop(&mut self) {
        self.state
            .pending_connections
            .fetch_sub(1, Ordering::AcqRel);
    }
}

struct RunningSession {
    local_url: String,
    public_url: String,
    session_id: String,
    relay: Arc<RelayState>,
    cancellation: CancellationToken,
    local_task: JoinHandle<()>,
    tunnel_task: JoinHandle<()>,
    alive: Arc<AtomicBool>,
}

#[derive(Default)]
pub(crate) struct CollaborationManager {
    session: Mutex<Option<RunningSession>>,
    starting: AtomicBool,
}

impl CollaborationManager {
    pub(crate) fn shutdown_now(&self) {
        if let Some(session) = self
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
        {
            log::info!("Collaboration host stopping because the main window was destroyed.");
            session
                .relay
                .set_shutdown_reason(RelayShutdownReason::SessionEnded);
            session.cancellation.cancel();
        }
    }
}

impl Drop for CollaborationManager {
    fn drop(&mut self) {
        if let Ok(session) = self.session.get_mut() {
            if let Some(session) = session.as_ref() {
                session
                    .relay
                    .set_shutdown_reason(RelayShutdownReason::SessionEnded);
                session.cancellation.cancel();
            }
        }
    }
}

struct StartingGuard<'a>(&'a AtomicBool);

impl Drop for StartingGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

async fn shutdown_running_session(session: RunningSession, reason: RelayShutdownReason) {
    session.relay.set_shutdown_reason(reason);
    session.cancellation.cancel();
    let mut local_task = session.local_task;
    let mut tunnel_task = session.tunnel_task;
    let stopped = timeout(Duration::from_secs(5), async {
        let _ = (&mut local_task).await;
        let _ = (&mut tunnel_task).await;
    })
    .await;
    if stopped.is_err() {
        local_task.abort();
        tunnel_task.abort();
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StartCollaborationResult {
    local_url: String,
    public_url: String,
    session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollaborationStatus {
    active: bool,
    local_url: Option<String>,
    public_url: Option<String>,
    session_id: Option<String>,
    participants: Vec<Participant>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct CollaborationAssetRequest {
    sha256: String,
    relative_path: String,
    content_type: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CollaborationAssetResult {
    sha256: String,
    size: u64,
    path: String,
}

#[tauri::command]
pub(crate) async fn start_collaboration(
    manager: TauriState<'_, CollaborationManager>,
    authtoken: String,
    session_id: String,
    join_secret: String,
    host_secret: String,
    default_role: CollaborationRole,
    domain: Option<String>,
) -> Result<StartCollaborationResult, String> {
    if manager.starting.swap(true, Ordering::AcqRel) {
        return Err("A collaboration session is already starting.".into());
    }
    let _starting = StartingGuard(&manager.starting);

    let stale_session = {
        let mut guard = manager
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.as_ref().is_some_and(|session| {
            session.alive.load(Ordering::Acquire) && !session.cancellation.is_cancelled()
        }) {
            return Err("A collaboration session is already running.".into());
        }
        guard.take()
    };
    if let Some(stale) = stale_session {
        shutdown_running_session(stale, RelayShutdownReason::SessionEnded).await;
    }

    validate_session_id(&session_id)?;
    validate_secret("Join secret", &join_secret)?;
    validate_secret("Host secret", &host_secret)?;
    if host_secret
        .as_bytes()
        .ct_eq(join_secret.as_bytes())
        .unwrap_u8()
        == 1
    {
        return Err("Host and join credentials must be different.".into());
    }
    if default_role == CollaborationRole::Host {
        return Err("The default guest role must be editor or viewer.".into());
    }
    if authtoken.trim().is_empty() || authtoken.len() > 2048 {
        return Err("Enter a valid ngrok authtoken.".into());
    }
    let domain = validate_domain(domain)?;

    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| "Could not start the local collaboration relay.".to_string())?;
    let local_address = listener
        .local_addr()
        .map_err(|_| "Could not read the local collaboration address.".to_string())?;
    let local_url = format!("http://{local_address}");

    // The token is moved directly into the ngrok SDK. Feather never logs it, writes it to disk,
    // places it in application state, or includes an SDK error that might echo credentials.
    let ngrok_session = ngrok::Session::builder()
        .authtoken(authtoken)
        .connect()
        .await
        .map_err(|_| {
            "Could not connect to ngrok. Check the authtoken and network connection.".to_string()
        })?;
    let mut endpoint = ngrok_session.http_endpoint();
    if let Some(domain) = domain {
        endpoint.domain(domain);
    }
    // Use ngrok's supported forwarder so endpoint connections receive the SDK's protocol,
    // proxy-header, reconnect, and shutdown handling instead of a hand-written byte pump.
    let mut forwarder = endpoint
        .listen_and_forward(
            local_url
                .parse()
                .map_err(|_| "Could not prepare the local collaboration endpoint.".to_string())?,
        )
        .await
        .map_err(|_| {
            "Could not start the ngrok endpoint. Check the domain and account plan.".to_string()
        })?;
    let public_url = forwarder.url().trim_end_matches('/').to_string();

    let cancellation = CancellationToken::new();
    let alive = Arc::new(AtomicBool::new(true));
    let relay = Arc::new(RelayState {
        session_id: session_id.clone(),
        credentials: CredentialHashes::new(&host_secret, &join_secret),
        default_role,
        participants: RwLock::new(HashMap::new()),
        kicked_clients: RwLock::new(HashSet::new()),
        assets: RwLock::new(HashMap::new()),
        asset_rate_limit: Mutex::new(AssetDownloadLimit::new()),
        asset_concurrency: Arc::new(Semaphore::new(MAX_SESSION_ASSET_CONCURRENCY)),
        pending_connections: AtomicUsize::new(0),
        cancellation: cancellation.clone(),
        shutdown_reason: RwLock::new(RelayShutdownReason::SessionEnded),
    });
    // Remove plaintext credentials as soon as their salted hashes have been created.
    drop(host_secret);
    drop(join_secret);

    let router = Router::new()
        .route("/collaboration/ws", get(websocket_route))
        .route(
            "/collaboration/assets/{sha256}",
            get(asset_route).options(asset_options),
        )
        .with_state(relay.clone());
    let local_cancellation = cancellation.clone();
    let local_alive = alive.clone();
    let local_relay = relay.clone();
    let local_task = tokio::spawn(async move {
        let shutdown = local_cancellation.clone();
        let result = axum::serve(listener, router)
            .with_graceful_shutdown(async move { shutdown.cancelled().await })
            .await;
        if result.is_err() && !local_cancellation.is_cancelled() {
            log::error!("The local collaboration relay exited unexpectedly.");
            local_relay.set_shutdown_reason(RelayShutdownReason::RelayUnavailable);
            local_cancellation.cancel();
        }
        local_alive.store(false, Ordering::Release);
    });

    let tunnel_cancellation = cancellation.clone();
    let tunnel_alive = alive.clone();
    let tunnel_relay = relay.clone();
    let tunnel_task = tokio::spawn(async move {
        let forwarding_exit = tokio::select! {
            result = forwarder.join() => Some(result),
            _ = tunnel_cancellation.cancelled() => None,
        };
        if forwarding_exit.is_some() {
            if !tunnel_cancellation.is_cancelled() {
                log::error!("The ngrok collaboration forwarder exited unexpectedly.");
                tunnel_relay.set_shutdown_reason(RelayShutdownReason::TunnelUnavailable);
                tunnel_cancellation.cancel();
            }
        } else {
            let _ = forwarder.close().await;
            let _ = timeout(Duration::from_secs(2), forwarder.join()).await;
        }
        tunnel_alive.store(false, Ordering::Release);
    });

    let result = StartCollaborationResult {
        local_url: local_url.clone(),
        public_url: public_url.clone(),
        session_id: session_id.clone(),
    };
    *manager
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(RunningSession {
        local_url,
        public_url,
        session_id,
        relay,
        cancellation,
        local_task,
        tunnel_task,
        alive,
    });

    // A listener can be allocated before an account/network failure closes its forwarding task.
    // Do not report a successful host start until it survives that immediate failure window.
    tokio::time::sleep(TUNNEL_STARTUP_STABILITY).await;
    let failed_session = {
        let mut guard = manager
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if guard.as_ref().is_some_and(|session| {
            !session.alive.load(Ordering::Acquire) || session.cancellation.is_cancelled()
        }) {
            guard.take()
        } else {
            None
        }
    };
    if let Some(failed) = failed_session {
        let reason = failed.relay.shutdown_reason();
        shutdown_running_session(failed, reason).await;
        return Err(match reason {
            RelayShutdownReason::TunnelUnavailable => {
                "The ngrok endpoint closed immediately. Check the account limits and network connection, then try again."
            }
            RelayShutdownReason::RelayUnavailable => {
                "The local collaboration relay stopped before the session became ready."
            }
            RelayShutdownReason::SessionEnded => "The collaboration session was stopped before it became ready.",
        }
        .to_string());
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn stop_collaboration(
    manager: TauriState<'_, CollaborationManager>,
) -> Result<(), String> {
    log::info!("Collaboration host stop requested by the frontend.");
    let session = manager
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take();
    if let Some(session) = session {
        shutdown_running_session(session, RelayShutdownReason::SessionEnded).await;
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn collaboration_status(
    manager: TauriState<'_, CollaborationManager>,
) -> CollaborationStatus {
    let guard = manager
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(session) = guard.as_ref() else {
        return CollaborationStatus {
            active: false,
            local_url: None,
            public_url: None,
            session_id: None,
            participants: Vec::new(),
        };
    };
    let active = session.alive.load(Ordering::Acquire) && !session.cancellation.is_cancelled();
    CollaborationStatus {
        active,
        local_url: active.then(|| session.local_url.clone()),
        public_url: active.then(|| session.public_url.clone()),
        session_id: active.then(|| session.session_id.clone()),
        participants: if active {
            session.relay.roster()
        } else {
            Vec::new()
        },
    }
}

#[tauri::command]
pub(crate) async fn register_collaboration_assets(
    app: AppHandle,
    manager: TauriState<'_, CollaborationManager>,
    project_dir: String,
    assets: Vec<CollaborationAssetRequest>,
) -> Result<Vec<CollaborationAssetResult>, String> {
    if assets.is_empty() || assets.len() > 256 {
        return Err("Register between 1 and 256 collaboration assets at a time.".into());
    }
    super::ensure_project_scope(&app, &project_dir)?;
    let relay = {
        let guard = manager
            .session
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let session = guard
            .as_ref()
            .filter(|session| {
                session.alive.load(Ordering::Acquire) && !session.cancellation.is_cancelled()
            })
            .ok_or_else(|| {
                "Start a collaboration session before registering assets.".to_string()
            })?;
        session.relay.clone()
    };

    let project_root = std::fs::canonicalize(&project_dir)
        .map_err(|_| "Could not open the project directory.".to_string())?;
    let mut staged = Vec::with_capacity(assets.len());
    let mut seen = std::collections::HashSet::with_capacity(assets.len());
    for request in assets {
        let sha256 = normalize_sha256(&request.sha256)?;
        if !seen.insert(sha256.clone()) {
            return Err(format!("Asset hash is listed more than once: {sha256}"));
        }
        let target = super::checked_project_target(&project_dir, &request.relative_path, false)?;
        let symlink_metadata = std::fs::symlink_metadata(&target).map_err(|_| {
            format!(
                "Could not open collaboration asset: {}",
                request.relative_path
            )
        })?;
        if symlink_metadata.file_type().is_symlink() || !symlink_metadata.is_file() {
            return Err(format!(
                "Collaboration assets must be regular project files: {}",
                request.relative_path
            ));
        }
        let canonical = std::fs::canonicalize(&target).map_err(|_| {
            format!(
                "Could not open collaboration asset: {}",
                request.relative_path
            )
        })?;
        if !canonical.starts_with(&project_root) {
            return Err(format!(
                "Collaboration asset escapes the project: {}",
                request.relative_path
            ));
        }
        let metadata = std::fs::metadata(&canonical).map_err(|_| {
            format!(
                "Could not inspect collaboration asset: {}",
                request.relative_path
            )
        })?;
        if metadata.len() > MAX_ASSET_BYTES {
            return Err("Individual collaboration assets are limited to 512 MiB.".into());
        }
        let actual_hash = hash_asset_file(&canonical).await?;
        let final_metadata = std::fs::metadata(&canonical).map_err(|_| {
            format!(
                "Collaboration asset changed while hashing: {}",
                request.relative_path
            )
        })?;
        if final_metadata.len() != metadata.len()
            || final_metadata.modified().ok() != metadata.modified().ok()
        {
            return Err(format!(
                "Collaboration asset changed while hashing: {}",
                request.relative_path
            ));
        }
        if actual_hash.as_bytes().ct_eq(sha256.as_bytes()).unwrap_u8() != 1 {
            return Err(format!(
                "Collaboration asset hash does not match its file: {}",
                request.relative_path
            ));
        }
        let content_type = validate_content_type(request.content_type)?;
        staged.push((
            sha256.clone(),
            RegisteredAsset {
                path: canonical,
                project_root: project_root.clone(),
                size: metadata.len(),
                modified: metadata.modified().ok(),
                content_type,
            },
            CollaborationAssetResult {
                sha256: sha256.clone(),
                size: metadata.len(),
                path: format!("/collaboration/assets/{sha256}"),
            },
        ));
    }

    let mut registered = relay
        .assets
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let new_assets = staged
        .iter()
        .filter(|(hash, _, _)| !registered.contains_key(hash))
        .count();
    if registered.len() + new_assets > MAX_REGISTERED_ASSETS {
        return Err("A collaboration session can register at most 4096 assets.".into());
    }
    let mut results = Vec::with_capacity(staged.len());
    for (hash, asset, result) in staged {
        registered.insert(hash, asset);
        results.push(result);
    }
    Ok(results)
}

async fn hash_asset_file(path: &std::path::Path) -> Result<String, String> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|_| "Could not read a collaboration asset.".to_string())?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|_| "Could not read a collaboration asset.".to_string())?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(hex_lower(&digest.finalize()))
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(HEX[(byte >> 4) as usize] as char);
        encoded.push(HEX[(byte & 0x0f) as usize] as char);
    }
    encoded
}

async fn asset_options() -> Response {
    Response::builder()
        .status(StatusCode::NO_CONTENT)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCESS_CONTROL_ALLOW_METHODS, "GET, OPTIONS")
        .header(header::ACCESS_CONTROL_ALLOW_HEADERS, "Authorization, Range")
        .header(header::ACCESS_CONTROL_MAX_AGE, "600")
        .body(Body::empty())
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

async fn asset_route(
    Path(requested_hash): Path<String>,
    State(state): State<Arc<RelayState>>,
    headers: HeaderMap,
) -> Response {
    let Some(access) = asset_request_access(&state, &headers) else {
        return asset_error(
            StatusCode::UNAUTHORIZED,
            "Asset authentication failed.",
            None,
        );
    };
    let session_permit = match state.asset_concurrency.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return asset_error(
                StatusCode::TOO_MANY_REQUESTS,
                "The host is already serving the maximum number of assets.",
                None,
            )
        }
    };
    let client_permit = match access.concurrency.clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            return asset_error(
                StatusCode::TOO_MANY_REQUESTS,
                "This participant has too many active asset downloads.",
                None,
            )
        }
    };
    if !reserve_asset_request(&state, &access) {
        return asset_error(
            StatusCode::TOO_MANY_REQUESTS,
            "The collaboration asset request limit was reached. Try again later.",
            None,
        );
    }
    let sha256 = match normalize_sha256(&requested_hash) {
        Ok(sha256) => sha256,
        Err(_) => return asset_error(StatusCode::NOT_FOUND, "Asset not found.", None),
    };
    let asset = {
        state
            .assets
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(&sha256)
            .cloned()
    };
    let Some(asset) = asset else {
        return asset_error(StatusCode::NOT_FOUND, "Asset not found.", None);
    };

    let canonical = match tokio::fs::canonicalize(&asset.path).await {
        Ok(canonical) if canonical == asset.path && canonical.starts_with(&asset.project_root) => {
            canonical
        }
        _ => return asset_error(StatusCode::GONE, "Asset is no longer available.", None),
    };
    let symlink_metadata = match tokio::fs::symlink_metadata(&canonical).await {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => metadata,
        _ => return asset_error(StatusCode::GONE, "Asset is no longer available.", None),
    };
    if symlink_metadata.len() != asset.size || symlink_metadata.modified().ok() != asset.modified {
        return asset_error(
            StatusCode::GONE,
            "Asset changed after it was registered.",
            None,
        );
    }

    let etag = format!("\"{sha256}\"");
    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        == Some(etag.as_str())
    {
        return asset_response_builder(StatusCode::NOT_MODIFIED, &asset, &etag)
            .body(Body::empty())
            .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response());
    }

    let requested_range = headers.get(header::RANGE);
    let (start, end, status) = match requested_range {
        Some(value) => match value
            .to_str()
            .ok()
            .and_then(|value| parse_byte_range(value, asset.size).ok())
        {
            Some((start, end)) => (start, end, StatusCode::PARTIAL_CONTENT),
            None => {
                return asset_error(
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "Requested asset range is invalid.",
                    Some(asset.size),
                )
            }
        },
        None => (0, asset.size.saturating_sub(1), StatusCode::OK),
    };
    let length = if asset.size == 0 { 0 } else { end - start + 1 };
    if !reserve_asset_bytes(&state, &access, length) {
        return asset_error(
            StatusCode::TOO_MANY_REQUESTS,
            "The collaboration asset transfer limit was reached. Try again later.",
            None,
        );
    }
    let mut file = match tokio::fs::File::open(&canonical).await {
        Ok(file) => file,
        Err(_) => return asset_error(StatusCode::GONE, "Asset is no longer available.", None),
    };
    if start > 0 && file.seek(std::io::SeekFrom::Start(start)).await.is_err() {
        return asset_error(StatusCode::GONE, "Asset is no longer available.", None);
    }
    // Keep both permits alive until the response stream is dropped, including client disconnects.
    let permits = (session_permit, client_permit);
    let stream = ReaderStream::new(file.take(length)).map_ok(move |bytes| {
        let _keep_alive = &permits;
        bytes
    });
    let mut builder = asset_response_builder(status, &asset, &etag);
    builder = builder.header(header::CONTENT_LENGTH, length.to_string());
    if status == StatusCode::PARTIAL_CONTENT {
        builder = builder.header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", asset.size),
        );
    }
    builder
        .body(Body::from_stream(stream))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}

fn asset_request_access(state: &RelayState, headers: &HeaderMap) -> Option<AssetAccess> {
    let credential = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|credential| !credential.is_empty() && credential.len() <= 128)?;
    state.asset_access_for(credential)
}

fn reserve_asset_request(state: &RelayState, access: &AssetAccess) -> bool {
    // Every reservation takes locks in session -> participant order, so concurrent requests cannot
    // oversubscribe either budget and cannot deadlock on opposite lock ordering.
    let now = Instant::now();
    let mut session_limit = state
        .asset_rate_limit
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut client_limit = access
        .rate_limit
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session_limit.refresh(now);
    client_limit.refresh(now);
    if !session_limit.can_accept_request(MAX_SESSION_ASSET_REQUESTS)
        || !client_limit.can_accept_request(MAX_CLIENT_ASSET_REQUESTS)
    {
        return false;
    }
    session_limit.reserve_request();
    client_limit.reserve_request();
    true
}

fn reserve_asset_bytes(state: &RelayState, access: &AssetAccess, bytes: u64) -> bool {
    let now = Instant::now();
    let mut session_limit = state
        .asset_rate_limit
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut client_limit = access
        .rate_limit
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session_limit.refresh(now);
    client_limit.refresh(now);
    if !session_limit.can_accept_bytes(bytes, MAX_SESSION_ASSET_BYTES)
        || !client_limit.can_accept_bytes(bytes, MAX_CLIENT_ASSET_BYTES)
    {
        return false;
    }
    session_limit.reserve_bytes(bytes);
    client_limit.reserve_bytes(bytes);
    true
}

fn asset_response_builder(
    status: StatusCode,
    asset: &RegisteredAsset,
    etag: &str,
) -> axum::http::response::Builder {
    Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(
            header::ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range, ETag",
        )
        .header(header::ACCEPT_RANGES, "bytes")
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header(header::ETAG, etag)
        .header(header::CONTENT_TYPE, asset.content_type.as_str())
        .header("X-Content-Type-Options", "nosniff")
}

fn asset_error(status: StatusCode, message: &'static str, complete_size: Option<u64>) -> Response {
    let mut builder = Response::builder()
        .status(status)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::CACHE_CONTROL, "no-store")
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header("X-Content-Type-Options", "nosniff");
    if let Some(complete_size) = complete_size {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes */{complete_size}"));
    }
    builder
        .body(Body::from(message))
        .unwrap_or_else(|_| status.into_response())
}

fn parse_byte_range(value: &str, size: u64) -> Result<(u64, u64), ()> {
    let value = value.strip_prefix("bytes=").ok_or(())?;
    if value.contains(',') || size == 0 {
        return Err(());
    }
    let (start, end) = value.split_once('-').ok_or(())?;
    if start.is_empty() {
        let suffix: u64 = end.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        return Ok((size.saturating_sub(suffix.min(size)), size - 1));
    }
    let start: u64 = start.parse().map_err(|_| ())?;
    if start >= size {
        return Err(());
    }
    let end = if end.is_empty() {
        size - 1
    } else {
        end.parse::<u64>().map_err(|_| ())?.min(size - 1)
    };
    if end < start {
        return Err(());
    }
    Ok((start, end))
}

async fn websocket_route(
    State(state): State<Arc<RelayState>>,
    websocket: WebSocketUpgrade,
) -> impl IntoResponse {
    websocket
        .max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_socket(socket, state))
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AuthMessage {
    v: u8,
    #[serde(rename = "type")]
    message_type: String,
    session_id: String,
    credential: String,
    name: String,
    client_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(
    deny_unknown_fields,
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
enum ClientCommand {
    #[serde(rename = "presence")]
    Presence { v: u8, data: Value },
    #[serde(rename = "update")]
    Update { v: u8, update: String },
    #[serde(rename = "syncRequest")]
    SyncRequest { v: u8 },
    #[serde(rename = "syncState")]
    SyncState {
        v: u8,
        target_id: String,
        update: String,
    },
    #[serde(rename = "setRole")]
    SetRole {
        v: u8,
        participant_id: String,
        role: CollaborationRole,
    },
    #[serde(rename = "kick")]
    Kick { v: u8, participant_id: String },
}

impl ClientCommand {
    fn version(&self) -> u8 {
        match self {
            Self::Presence { v, .. }
            | Self::Update { v, .. }
            | Self::SyncRequest { v }
            | Self::SyncState { v, .. }
            | Self::SetRole { v, .. }
            | Self::Kick { v, .. } => *v,
        }
    }
}

struct RateLimit {
    message_window: Instant,
    message_count: u32,
    message_bytes: u64,
    presence_window: Instant,
    presence_count: u32,
}

impl RateLimit {
    fn new() -> Self {
        let now = Instant::now();
        Self {
            message_window: now,
            message_count: 0,
            message_bytes: 0,
            presence_window: now,
            presence_count: 0,
        }
    }

    fn accept_message(&mut self, is_presence: bool, message_bytes: usize) -> bool {
        let now = Instant::now();
        if now.duration_since(self.message_window) >= Duration::from_secs(10) {
            self.message_window = now;
            self.message_count = 0;
            self.message_bytes = 0;
        }
        self.message_count += 1;
        self.message_bytes = self.message_bytes.saturating_add(message_bytes as u64);
        if self.message_count > MAX_MESSAGES_PER_RATE_WINDOW
            || self.message_bytes > MAX_RATE_WINDOW_BYTES
        {
            return false;
        }
        if is_presence {
            if now.duration_since(self.presence_window) >= Duration::from_secs(1) {
                self.presence_window = now;
                self.presence_count = 0;
            }
            self.presence_count += 1;
            if self.presence_count > 30 {
                return false;
            }
        }
        true
    }
}

async fn handle_socket(mut socket: WebSocket, state: Arc<RelayState>) {
    if state.pending_connections.fetch_add(1, Ordering::AcqRel) >= MAX_PENDING_CONNECTIONS {
        state.pending_connections.fetch_sub(1, Ordering::AcqRel);
        let _ = close_socket(&mut socket, close_code::AGAIN, "Server busy").await;
        return;
    }
    let pending_guard = PendingConnectionGuard {
        state: state.clone(),
    };

    let auth = match receive_auth(&mut socket, &state).await {
        Ok(auth) => auth,
        Err((code, reason)) => {
            let _ = socket
                .send(error_message("auth_failed", "Authentication failed."))
                .await;
            let _ = close_socket(&mut socket, code, reason).await;
            return;
        }
    };
    let Some(role) = state
        .credentials
        .authenticate(&auth.credential, state.default_role)
    else {
        let _ = socket
            .send(error_message("auth_failed", "Authentication failed."))
            .await;
        let _ = close_socket(&mut socket, close_code::POLICY, "Authentication failed").await;
        return;
    };
    drop(auth.credential);

    let participant = Participant {
        id: Uuid::new_v4().to_string(),
        client_id: auth.client_id,
        name: auth.name.trim().to_string(),
        role,
    };
    let asset_token = random_asset_token();
    let asset_token_hash = hash_asset_token(&asset_token);
    let was_kicked = state
        .kicked_clients
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .contains(&participant.client_id);
    if was_kicked {
        let _ = socket
            .send(error_message(
                "kicked",
                "You were removed from this session.",
            ))
            .await;
        let _ = close_socket(&mut socket, close_code::POLICY, "Removed by host").await;
        return;
    }
    let (outbound, mut outbound_rx) = mpsc::channel(OUTBOUND_QUEUE_CAPACITY);
    let (admission_error, replaced_connection) = {
        let mut participants = state
            .participants
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let duplicate = participants
            .iter()
            .find(|(_, entry)| entry.public.client_id == participant.client_id)
            .map(|(id, entry)| (id.clone(), entry.public.role));
        if duplicate
            .as_ref()
            .is_some_and(|(_, existing_role)| existing_role.is_host() != role.is_host())
        {
            (Some((close_code::POLICY, "Client identity conflict")), None)
        } else if participants.len() >= MAX_PARTICIPANTS && duplicate.is_none() {
            (Some((close_code::AGAIN, "Session is full")), None)
        } else {
            let replaced = duplicate
                .map(|(id, _)| id)
                .and_then(|id| participants.remove(&id))
                .map(|entry| entry.outbound);
            participants.insert(
                participant.id.clone(),
                ParticipantEntry {
                    public: participant.clone(),
                    outbound,
                    asset_token_hash,
                    asset_rate_limit: Arc::new(Mutex::new(AssetDownloadLimit::new())),
                    asset_concurrency: Arc::new(Semaphore::new(MAX_CLIENT_ASSET_CONCURRENCY)),
                },
            );
            (None, replaced)
        }
    };
    if let Some((code, reason)) = admission_error {
        let _ = close_socket(&mut socket, code, reason).await;
        return;
    }
    if let Some(replaced) = replaced_connection {
        let _ = replaced.try_send(error_message(
            "superseded",
            "This client reconnected from another connection.",
        ));
        let _ = replaced.try_send(Message::Close(Some(CloseFrame {
            code: close_code::POLICY,
            reason: "Reconnected elsewhere".into(),
        })));
    }
    drop(pending_guard);

    let welcome = json_message(json!({
      "v": PROTOCOL_VERSION,
      "type": "welcome",
      "sessionId": state.session_id,
      "participant": participant,
      "participants": state.roster(),
      "assetToken": asset_token,
      "serverTime": unix_time_millis(),
    }));
    if socket.send(welcome).await.is_err() {
        remove_participant(&state, &participant.id);
        return;
    }
    state.broadcast_roster();

    let (mut socket_tx, mut socket_rx) = socket.split();
    let mut heartbeat = interval(HEARTBEAT_INTERVAL);
    heartbeat.tick().await;
    let mut last_seen = Instant::now();
    let mut rate_limit = RateLimit::new();

    loop {
        tokio::select! {
          _ = state.cancellation.cancelled() => {
            let _ = socket_tx.send(Message::Close(Some(CloseFrame {
              code: close_code::AWAY,
              reason: state.shutdown_reason().close_reason().into(),
            }))).await;
            break;
          }
          _ = heartbeat.tick() => {
            if last_seen.elapsed() > HEARTBEAT_TIMEOUT {
              let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                code: close_code::AWAY,
                reason: "Heartbeat timeout".into(),
              }))).await;
              break;
            }
            if socket_tx.send(Message::Ping(Vec::new().into())).await.is_err() {
              break;
            }
          }
          outbound_message = outbound_rx.recv() => {
            let Some(outbound_message) = outbound_message else { break; };
            let closing = matches!(outbound_message, Message::Close(_));
            if socket_tx.send(outbound_message).await.is_err() || closing {
              break;
            }
          }
          incoming = socket_rx.next() => {
            let Some(Ok(incoming)) = incoming else { break; };
            last_seen = Instant::now();
            match incoming {
              Message::Text(text) => {
                let command = match serde_json::from_str::<ClientCommand>(text.as_str()) {
                  Ok(command) => command,
                  Err(_) => {
                    let _ = socket_tx
                      .send(error_message("invalid_message", "Message does not match protocol v1."))
                      .await;
                    let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                      code: close_code::POLICY,
                      reason: "Invalid collaboration message".into(),
                    }))).await;
                    break;
                  }
                };
                let is_presence = matches!(command, ClientCommand::Presence { .. });
                if !rate_limit.accept_message(is_presence, text.len()) {
                  let _ = socket_tx
                    .send(error_message("rate_limited", "Too many collaboration messages."))
                    .await;
                  let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                    code: close_code::POLICY,
                    reason: "Too many collaboration messages".into(),
                  }))).await;
                  break;
                }
                if let Err((code, message)) = handle_command(&state, &participant.id, command) {
                  state.send_error(&participant.id, code, message);
                }
              }
              Message::Binary(binary) => {
                if !rate_limit.accept_message(false, binary.len()) {
                  let _ = socket_tx
                    .send(error_message("rate_limited", "Too many collaboration messages."))
                    .await;
                  let _ = socket_tx.send(Message::Close(Some(CloseFrame {
                    code: close_code::POLICY,
                    reason: "Too many collaboration messages".into(),
                  }))).await;
                  break;
                }
                if let Err((code, message)) = handle_binary_update(&state, &participant.id, binary.as_ref()) {
                  state.send_error(&participant.id, code, message);
                }
              }
              Message::Ping(payload) => {
                let _ = socket_tx.send(Message::Pong(payload)).await;
              }
              Message::Pong(_) => {}
              Message::Close(_) => break,
            }
          }
        }
    }

    remove_participant(&state, &participant.id);
}

async fn receive_auth(
    socket: &mut WebSocket,
    state: &RelayState,
) -> Result<AuthMessage, (u16, &'static str)> {
    let incoming = timeout(AUTH_TIMEOUT, socket.recv())
        .await
        .map_err(|_| (close_code::POLICY, "Authentication timed out"))?
        .ok_or((close_code::POLICY, "Authentication required"))?
        .map_err(|_| (close_code::PROTOCOL, "Invalid WebSocket frame"))?;
    let Message::Text(text) = incoming else {
        return Err((close_code::POLICY, "Authentication must be a text frame"));
    };
    let auth: AuthMessage = serde_json::from_str(text.as_str())
        .map_err(|_| (close_code::POLICY, "Invalid authentication message"))?;
    if auth.v != PROTOCOL_VERSION || auth.message_type != "auth" {
        return Err((close_code::PROTOCOL, "Unsupported collaboration protocol"));
    }
    if auth.session_id != state.session_id {
        return Err((close_code::POLICY, "Authentication failed"));
    }
    validate_identity(&auth.name, &auth.client_id)
        .map_err(|_| (close_code::POLICY, "Invalid participant identity"))?;
    if auth.credential.is_empty() || auth.credential.len() > 512 {
        return Err((close_code::POLICY, "Authentication failed"));
    }
    Ok(auth)
}

fn handle_command(
    state: &RelayState,
    participant_id: &str,
    command: ClientCommand,
) -> Result<(), (&'static str, &'static str)> {
    if command.version() != PROTOCOL_VERSION {
        return Err(("unsupported_version", "Unsupported collaboration protocol."));
    }
    let role = state
        .role_for(participant_id)
        .ok_or(("not_connected", "Participant is no longer connected."))?;
    authorize_command(role, &command)?;

    match command {
        ClientCommand::Presence { data, .. } => {
            if serde_json::to_vec(&data).map_or(true, |bytes| bytes.len() > MAX_PRESENCE_BYTES) {
                return Err(("message_too_large", "Presence data is limited to 32 KiB."));
            }
            state.broadcast(
                json_message(json!({
                  "v": PROTOCOL_VERSION,
                  "type": "presence",
                  "participantId": participant_id,
                  "data": data,
                })),
                Some(participant_id),
            );
        }
        ClientCommand::Update { update, .. } => {
            let decoded = BASE64
                .decode(update.as_bytes())
                .map_err(|_| ("invalid_update", "Live update must be valid base64."))?;
            if decoded.is_empty() || decoded.len() > MAX_SYNC_UPDATE_BYTES {
                return Err((
                    "message_too_large",
                    "Live updates must be between 1 byte and 32 MiB.",
                ));
            }
            state.broadcast(
                json_message(json!({
                  "v": PROTOCOL_VERSION,
                  "type": "update",
                  "update": update,
                })),
                Some(participant_id),
            );
        }
        ClientCommand::SyncRequest { .. } => {
            let authors: Vec<_> = state
                .participants
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .iter()
                .filter(|(id, entry)| id.as_str() != participant_id && entry.public.role.can_edit())
                .map(|(_, entry)| entry.outbound.clone())
                .collect();
            if authors.is_empty() && !role.is_host() {
                return Err(("host_unavailable", "The host is not connected."));
            }
            let request = json_message(json!({
              "v": PROTOCOL_VERSION,
              "type": "syncRequest",
              "participantId": participant_id,
            }));
            for author in authors {
                let _ = author.try_send(request.clone());
            }
        }
        ClientCommand::SyncState {
            target_id, update, ..
        } => {
            let decoded = BASE64
                .decode(update.as_bytes())
                .map_err(|_| ("invalid_update", "Sync state must be valid base64."))?;
            if decoded.is_empty() || decoded.len() > MAX_SYNC_UPDATE_BYTES {
                return Err((
                    "message_too_large",
                    "Sync state must be between 1 byte and 32 MiB.",
                ));
            }
            let target_role = state.role_for(&target_id).ok_or((
                "participant_not_found",
                "Participant is no longer connected.",
            ))?;
            if role == CollaborationRole::Editor && !target_role.is_host() {
                return Err((
                    "permission_denied",
                    "Editors may only return sync state to the host.",
                ));
            }
            let target = state.outbound_for(&target_id).ok_or((
                "participant_not_found",
                "Participant is no longer connected.",
            ))?;
            let _ = target.try_send(json_message(json!({
              "v": PROTOCOL_VERSION,
              "type": "syncState",
              "update": update,
            })));
        }
        ClientCommand::SetRole {
            participant_id: target_id,
            role: target_role,
            ..
        } => {
            if target_id == participant_id {
                return Err((
                    "invalid_target",
                    "Use another host to change your own role.",
                ));
            }
            let changed = {
                let mut participants = state
                    .participants
                    .write()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                let target = participants.get_mut(&target_id).ok_or((
                    "participant_not_found",
                    "Participant is no longer connected.",
                ))?;
                target.public.role = target_role;
                true
            };
            if changed {
                state.broadcast_roster();
            }
        }
        ClientCommand::Kick {
            participant_id: target_id,
            ..
        } => {
            if target_id == participant_id {
                return Err(("invalid_target", "A host cannot kick itself."));
            }
            let (target, client_id) = state
                .participants
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .get(&target_id)
                .map(|entry| (entry.outbound.clone(), entry.public.client_id.clone()))
                .ok_or((
                    "participant_not_found",
                    "Participant is no longer connected.",
                ))?;
            state
                .kicked_clients
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .insert(client_id);
            let _ = target.try_send(error_message(
                "kicked",
                "You were removed from this session.",
            ));
            let _ = target.try_send(Message::Close(Some(CloseFrame {
                code: close_code::POLICY,
                reason: "Removed by host".into(),
            })));
        }
    }
    Ok(())
}

fn authorize_command(
    role: CollaborationRole,
    command: &ClientCommand,
) -> Result<(), (&'static str, &'static str)> {
    let allowed = match command {
        ClientCommand::Presence { .. } | ClientCommand::SyncRequest { .. } => true,
        ClientCommand::Update { .. } => role.can_edit(),
        ClientCommand::SyncState { .. } => role.can_edit(),
        ClientCommand::SetRole { .. } | ClientCommand::Kick { .. } => role.is_host(),
    };
    if allowed {
        Ok(())
    } else {
        Err((
            "permission_denied",
            "The current collaboration role cannot perform this action.",
        ))
    }
}

fn handle_binary_update(
    state: &RelayState,
    participant_id: &str,
    binary: &[u8],
) -> Result<(), (&'static str, &'static str)> {
    validate_binary_update(state.role_for(participant_id), binary)?;
    state.broadcast(
        Message::Binary(binary.to_vec().into()),
        Some(participant_id),
    );
    Ok(())
}

fn validate_binary_update(
    role: Option<CollaborationRole>,
    binary: &[u8],
) -> Result<(), (&'static str, &'static str)> {
    if binary.len() <= 2 || binary.len() - 2 > MAX_SYNC_UPDATE_BYTES {
        return Err((
            "message_too_large",
            "Sync updates must be between 1 byte and 32 MiB.",
        ));
    }
    if binary[0] != PROTOCOL_VERSION || binary[1] != 1 {
        return Err((
            "invalid_update",
            "Binary frame must use the protocol-v1 update envelope.",
        ));
    }
    if !role.is_some_and(CollaborationRole::can_edit) {
        return Err((
            "permission_denied",
            "Viewers cannot change the shared project.",
        ));
    }
    Ok(())
}

fn remove_participant(state: &RelayState, participant_id: &str) {
    let removed = state
        .participants
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(participant_id)
        .is_some();
    if removed {
        state.broadcast_roster();
    }
}

fn json_message(value: Value) -> Message {
    Message::Text(value.to_string().into())
}

fn error_message(code: &str, message: &str) -> Message {
    json_message(json!({
      "v": PROTOCOL_VERSION,
      "type": "error",
      "code": code,
      "message": message,
    }))
}

async fn close_socket(socket: &mut WebSocket, code: u16, reason: &'static str) -> Result<(), ()> {
    socket
        .send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.into(),
        })))
        .await
        .map_err(|_| ())
}

fn unix_time_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn validate_session_id(session_id: &str) -> Result<(), String> {
    if !(3..=64).contains(&session_id.len())
        || !session_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Session IDs must be 3-64 letters, numbers, hyphens, or underscores.".into());
    }
    Ok(())
}

fn validate_secret(label: &str, secret: &str) -> Result<(), String> {
    if !(16..=512).contains(&secret.len()) {
        return Err(format!("{label} must contain 16-512 characters."));
    }
    Ok(())
}

fn validate_identity(name: &str, client_id: &str) -> Result<(), ()> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty()
        || trimmed_name.chars().count() > 64
        || trimmed_name.chars().any(char::is_control)
    {
        return Err(());
    }
    if !(3..=64).contains(&client_id.len())
        || !client_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(());
    }
    Ok(())
}

fn validate_domain(domain: Option<String>) -> Result<Option<String>, String> {
    let Some(domain) = domain else {
        return Ok(None);
    };
    let domain = domain.trim().trim_end_matches('.').to_ascii_lowercase();
    if domain.is_empty() {
        return Ok(None);
    }
    if domain.len() > 253
        || domain.contains(['/', ':', '*'])
        || !domain.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err("The ngrok domain must be a valid hostname without a scheme or path.".into());
    }
    Ok(Some(domain))
}

fn normalize_sha256(sha256: &str) -> Result<String, String> {
    if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Collaboration asset hashes must be 64 hexadecimal SHA-256 characters.".into());
    }
    Ok(sha256.to_ascii_lowercase())
}

fn validate_content_type(content_type: Option<String>) -> Result<String, String> {
    let content_type = content_type.unwrap_or_else(|| "application/octet-stream".into());
    let has_valid_parts = content_type
        .split_once('/')
        .is_some_and(|(kind, subtype)| !kind.is_empty() && !subtype.is_empty());
    if content_type.len() > 127
        || !has_valid_parts
        || content_type.matches('/').count() != 1
        || !content_type.bytes().all(|byte| {
            byte.is_ascii_alphanumeric()
                || matches!(
                    byte,
                    b'/' | b'!' | b'#' | b'$' | b'&' | b'^' | b'_' | b'.' | b'+' | b'-'
                )
        })
        || HeaderValue::from_str(&content_type).is_err()
    {
        return Err("Asset content types must be a simple valid MIME type.".into());
    }
    Ok(content_type.to_ascii_lowercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio_tungstenite::{connect_async, tungstenite::Message as ClientWsMessage};

    async fn authenticate_test_client(
        url: &str,
        session_id: &str,
        credential: &str,
        name: &str,
        client_id: &str,
    ) -> tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    > {
        let (mut socket, _) = connect_async(url).await.expect("connect test client");
        socket
            .send(ClientWsMessage::Text(
                json!({
                  "v": PROTOCOL_VERSION,
                  "type": "auth",
                  "sessionId": session_id,
                  "credential": credential,
                  "name": name,
                  "clientId": client_id,
                })
                .to_string()
                .into(),
            ))
            .await
            .expect("send test auth");
        timeout(Duration::from_secs(2), async {
            loop {
                let message = socket.next().await.expect("welcome frame").expect("valid frame");
                if let ClientWsMessage::Text(text) = message {
                    let value: Value = serde_json::from_str(text.as_ref()).expect("welcome json");
                    if value.get("type").and_then(Value::as_str) == Some("welcome") {
                        break;
                    }
                }
            }
        })
        .await
        .expect("welcome timeout");
        socket
    }

    async fn next_test_json_message(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        expected_type: &str,
    ) -> Value {
        timeout(Duration::from_secs(2), async {
            loop {
                let message = socket.next().await.expect("relay frame").expect("valid frame");
                if let ClientWsMessage::Text(text) = message {
                    let value: Value = serde_json::from_str(text.as_ref()).expect("relay json");
                    if value.get("type").and_then(Value::as_str) == Some(expected_type) {
                        break value;
                    }
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("{expected_type} timeout"))
    }

    async fn next_test_live_update(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    ) -> Value {
        next_test_json_message(socket, "update").await
    }

    async fn start_test_relay(
        session_id: &str,
        host_secret: &str,
        join_secret: &str,
    ) -> (Arc<RelayState>, CancellationToken, JoinHandle<()>, String) {
        let cancellation = CancellationToken::new();
        let state = Arc::new(RelayState {
            session_id: session_id.into(),
            credentials: CredentialHashes::new(host_secret, join_secret),
            default_role: CollaborationRole::Editor,
            participants: RwLock::new(HashMap::new()),
            kicked_clients: RwLock::new(HashSet::new()),
            assets: RwLock::new(HashMap::new()),
            asset_rate_limit: Mutex::new(AssetDownloadLimit::new()),
            asset_concurrency: Arc::new(Semaphore::new(MAX_SESSION_ASSET_CONCURRENCY)),
            pending_connections: AtomicUsize::new(0),
            cancellation: cancellation.clone(),
            shutdown_reason: RwLock::new(RelayShutdownReason::SessionEnded),
        });
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .expect("bind loopback relay");
        let address = listener.local_addr().expect("relay address");
        let router = Router::new()
            .route("/collaboration/ws", get(websocket_route))
            .with_state(state.clone());
        let shutdown = cancellation.clone();
        let server = tokio::spawn(async move {
            axum::serve(listener, router)
                .with_graceful_shutdown(async move { shutdown.cancelled().await })
                .await
                .expect("serve loopback relay");
        });
        (state, cancellation, server, format!("ws://{address}/collaboration/ws"))
    }

    #[test]
    fn shutdown_reasons_distinguish_user_stop_from_transport_failure() {
        assert_eq!(
            RelayShutdownReason::SessionEnded.close_reason(),
            "Session ended"
        );
        assert_eq!(
            RelayShutdownReason::TunnelUnavailable.close_reason(),
            "Ngrok tunnel unavailable"
        );
        assert_eq!(
            RelayShutdownReason::RelayUnavailable.close_reason(),
            "Local relay unavailable"
        );
    }

    #[test]
    fn credentials_are_hashed_and_roles_are_distinct() {
        let credentials =
            CredentialHashes::new("host-secret-which-is-long", "join-secret-which-is-long");
        assert_eq!(
            credentials.authenticate("host-secret-which-is-long", CollaborationRole::Viewer),
            Some(CollaborationRole::Host)
        );
        assert_eq!(
            credentials.authenticate("join-secret-which-is-long", CollaborationRole::Editor),
            Some(CollaborationRole::Editor)
        );
        assert_eq!(
            credentials.authenticate("incorrect-secret-value", CollaborationRole::Editor),
            None
        );
    }

    #[test]
    fn roles_enforce_sync_and_host_controls() {
        let update = [PROTOCOL_VERSION, 1, 42];
        assert!(validate_binary_update(Some(CollaborationRole::Host), &update).is_ok());
        assert!(validate_binary_update(Some(CollaborationRole::Editor), &update).is_ok());
        assert_eq!(
            validate_binary_update(Some(CollaborationRole::Viewer), &update)
                .unwrap_err()
                .0,
            "permission_denied"
        );

        let kick = ClientCommand::Kick {
            v: PROTOCOL_VERSION,
            participant_id: "participant".into(),
        };
        assert!(authorize_command(CollaborationRole::Host, &kick).is_ok());
        assert_eq!(
            authorize_command(CollaborationRole::Editor, &kick)
                .unwrap_err()
                .0,
            "permission_denied"
        );

        let sync_state = ClientCommand::SyncState {
            v: PROTOCOL_VERSION,
            target_id: "host".into(),
            update: BASE64.encode([1_u8, 2, 3]),
        };
        assert!(authorize_command(CollaborationRole::Host, &sync_state).is_ok());
        assert!(authorize_command(CollaborationRole::Editor, &sync_state).is_ok());
        assert_eq!(
            authorize_command(CollaborationRole::Viewer, &sync_state)
                .unwrap_err()
                .0,
            "permission_denied"
        );

        let live_update = ClientCommand::Update {
            v: PROTOCOL_VERSION,
            update: BASE64.encode([1_u8, 2, 3]),
        };
        assert!(authorize_command(CollaborationRole::Host, &live_update).is_ok());
        assert!(authorize_command(CollaborationRole::Editor, &live_update).is_ok());
        assert_eq!(
            authorize_command(CollaborationRole::Viewer, &live_update)
                .unwrap_err()
                .0,
            "permission_denied"
        );
    }

    #[test]
    fn protocol_schema_is_strict_and_versioned() {
        let presence: ClientCommand =
            serde_json::from_str(r#"{"v":1,"type":"presence","data":{"cursor":[10,20]}}"#).unwrap();
        assert_eq!(presence.version(), PROTOCOL_VERSION);
        let sync_state: ClientCommand = serde_json::from_value(json!({
          "v": PROTOCOL_VERSION,
          "type": "syncState",
          "targetId": "guest-1",
          "update": BASE64.encode([1_u8, 2, 3]),
        }))
        .expect("frontend syncState fields");
        assert!(matches!(
            sync_state,
            ClientCommand::SyncState { target_id, .. } if target_id == "guest-1"
        ));
        let set_role: ClientCommand = serde_json::from_value(json!({
          "v": PROTOCOL_VERSION,
          "type": "setRole",
          "participantId": "guest-1",
          "role": "viewer",
        }))
        .expect("frontend setRole fields");
        assert!(matches!(
            set_role,
            ClientCommand::SetRole { participant_id, .. } if participant_id == "guest-1"
        ));
        let kick: ClientCommand = serde_json::from_value(json!({
          "v": PROTOCOL_VERSION,
          "type": "kick",
          "participantId": "guest-1",
        }))
        .expect("frontend kick fields");
        assert!(matches!(
            kick,
            ClientCommand::Kick { participant_id, .. } if participant_id == "guest-1"
        ));
        assert!(serde_json::from_str::<ClientCommand>(
            r#"{"v":1,"type":"presence","data":{},"surprise":true}"#
        )
        .is_err());
        assert!(validate_binary_update(Some(CollaborationRole::Editor), &[1, 9, 42]).is_err());
    }

    #[test]
    fn identifiers_domains_and_secrets_are_validated() {
        assert!(validate_session_id("team-demo_1").is_ok());
        assert!(validate_session_id("../team").is_err());
        assert_eq!(
            validate_domain(Some("My-Team.ngrok.app.".into())).unwrap(),
            Some("my-team.ngrok.app".into())
        );
        assert!(validate_domain(Some("https://bad.example/path".into())).is_err());
        assert!(validate_secret("Join secret", "too-short").is_err());
    }

    #[test]
    fn presence_has_a_separate_rate_limit() {
        let mut limiter = RateLimit::new();
        for _ in 0..30 {
            assert!(limiter.accept_message(true, 100));
        }
        assert!(!limiter.accept_message(true, 100));
    }

    #[test]
    fn normal_live_drag_rate_stays_inside_the_general_limit() {
        let mut limiter = RateLimit::new();
        // 31 authored updates/s + 10 presence updates/s + control headroom for ten seconds.
        for _ in 0..500 {
            assert!(limiter.accept_message(false, 256));
        }
    }

    #[tokio::test]
    async fn loopback_relay_forwards_live_updates_in_both_directions() {
        let session_id = "relay-session-0123456789";
        let host_secret = "host-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
        let join_secret = "join-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
        let (state, cancellation, server, url) =
            start_test_relay(session_id, host_secret, join_secret).await;

        let mut host = authenticate_test_client(
            &url,
            session_id,
            host_secret,
            "Host",
            "host-client-1",
        )
        .await;
        let mut editor = authenticate_test_client(
            &url,
            session_id,
            join_secret,
            "Editor",
            "editor-client-1",
        )
        .await;

        editor
            .send(ClientWsMessage::Text(
                json!({ "v": PROTOCOL_VERSION, "type": "syncRequest" })
                    .to_string()
                    .into(),
            ))
            .await
            .expect("editor requests initial state");
        let sync_request = next_test_json_message(&mut host, "syncRequest").await;
        let editor_participant_id = sync_request
            .get("participantId")
            .and_then(Value::as_str)
            .expect("sync target");
        let initial_state = BASE64.encode([5_u8, 4, 3, 2, 1]);
        host.send(ClientWsMessage::Text(
            json!({
              "v": PROTOCOL_VERSION,
              "type": "syncState",
              "targetId": editor_participant_id,
              "update": initial_state,
            })
            .to_string()
            .into(),
        ))
        .await
        .expect("host returns initial state");
        assert_eq!(
            next_test_json_message(&mut editor, "syncState")
                .await
                .get("update"),
            Some(&Value::String(initial_state)),
        );
        assert_eq!(state.roster().len(), 2);

        let host_update = BASE64.encode([9_u8, 8, 7, 6]);
        host.send(ClientWsMessage::Text(
            json!({ "v": PROTOCOL_VERSION, "type": "update", "update": host_update })
                .to_string()
                .into(),
        ))
        .await
        .expect("host sends update");
        assert_eq!(
            next_test_live_update(&mut editor).await.get("update"),
            Some(&Value::String(host_update)),
        );

        let editor_update = BASE64.encode([1_u8, 2, 3, 4]);
        editor
            .send(ClientWsMessage::Text(
                json!({ "v": PROTOCOL_VERSION, "type": "update", "update": editor_update })
                    .to_string()
                    .into(),
            ))
            .await
            .expect("editor sends update");
        assert_eq!(
            next_test_live_update(&mut host).await.get("update"),
            Some(&Value::String(editor_update)),
        );

        cancellation.cancel();
        let _ = timeout(Duration::from_secs(2), server).await;
    }

    #[tokio::test]
    async fn rate_limited_client_receives_an_explicit_policy_close() {
        let session_id = "rate-session-0123456789";
        let host_secret = "host-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
        let join_secret = "join-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
        let (_state, cancellation, server, url) =
            start_test_relay(session_id, host_secret, join_secret).await;
        let mut editor = authenticate_test_client(
            &url,
            session_id,
            join_secret,
            "Fast editor",
            "fast-editor-client-1",
        )
        .await;

        for sequence in 0..=30 {
            editor
                .send(ClientWsMessage::Text(
                    json!({
                      "v": PROTOCOL_VERSION,
                      "type": "presence",
                      "data": { "lastSeenAt": sequence },
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .expect("send presence burst");
        }

        timeout(Duration::from_secs(2), async {
            let mut saw_rate_limit_error = false;
            loop {
                match editor.next().await.expect("terminal relay frame").expect("valid frame") {
                    ClientWsMessage::Text(text) => {
                        let value: Value = serde_json::from_str(text.as_ref()).expect("relay json");
                        if value.get("code").and_then(Value::as_str) == Some("rate_limited") {
                            saw_rate_limit_error = true;
                        }
                    }
                    ClientWsMessage::Close(Some(frame)) => {
                        assert!(saw_rate_limit_error);
                        assert_eq!(u16::from(frame.code), close_code::POLICY);
                        break;
                    }
                    ClientWsMessage::Close(None) => panic!("rate limit close had no reason"),
                    _ => {}
                }
            }
        })
        .await
        .expect("rate limit close timeout");

        cancellation.cancel();
        let _ = timeout(Duration::from_secs(2), server).await;
    }

    #[test]
    fn asset_ranges_are_single_and_bounded() {
        assert_eq!(parse_byte_range("bytes=0-99", 200), Ok((0, 99)));
        assert_eq!(parse_byte_range("bytes=100-", 200), Ok((100, 199)));
        assert_eq!(parse_byte_range("bytes=-20", 200), Ok((180, 199)));
        assert!(parse_byte_range("bytes=200-", 200).is_err());
        assert!(parse_byte_range("bytes=0-1,4-5", 200).is_err());
        assert!(parse_byte_range("items=0-1", 200).is_err());
    }

    #[test]
    fn asset_capabilities_are_random_and_download_budgets_are_bounded() {
        let first = random_asset_token();
        let second = random_asset_token();
        assert_ne!(first, second);
        assert!(first.len() >= 32);
        assert!(first
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')));
        assert_ne!(hash_asset_token(&first), hash_asset_token(&second));

        let mut limit = AssetDownloadLimit::new();
        let chunk = 512 * 1024 * 1024;
        assert!(limit.can_accept_request(MAX_CLIENT_ASSET_REQUESTS));
        limit.reserve_request();
        for _ in 0..4 {
            assert!(limit.can_accept_bytes(chunk, MAX_CLIENT_ASSET_BYTES));
            limit.reserve_bytes(chunk);
        }
        assert!(!limit.can_accept_bytes(1, MAX_CLIENT_ASSET_BYTES));
    }
}
