import type { ExportProfile, ExportTargetId, NodeForgeProject } from '../types';

/** One export platform (build target) an exported game can ship to. */
export type ExportTarget = ExportTargetId;

/** One toolchain requirement inside a platform-doctor report entry. */
export interface ExportRequirement {
  id: string;
  label: string;
  ok: boolean;
  /** How to install/fix it — present only when `ok` is false. */
  fix?: string;
}

/** Per-platform readiness from `scripts/platform-doctor.mjs`. */
export interface ExportPlatformInfo {
  id: ExportTargetId;
  label: string;
  kind: 'web' | 'desktop' | 'mobile';
  /** ready = buildable on this machine now; ci = build on another OS / GitHub Actions;
   *  missing = toolchain gaps (see requirements); unsupported = impossible here (iOS off-Mac). */
  status: 'ready' | 'ci' | 'missing' | 'unsupported';
  requirements: ExportRequirement[];
  notes?: string;
}

export interface ExportPlatformsReport {
  host: string;
  hostLabel: string;
  platforms: ExportPlatformInfo[];
}

/** Immutable request handed from the editor to a local or future remote build provider. */
export interface ProductionBuildRequest {
  bundleJson: string;
  profile: ExportProfile;
  targets: ExportTargetId[];
  outDir?: string;
}

/** Readiness of the local Steamworks ContentBuilder toolchain. */
export interface SteamToolReport {
  ready: boolean;
  steamcmdPath?: string;
  errors: string[];
}

/** Non-secret configuration for previewing or uploading one Steam depot build. */
export interface SteamPublishRequest {
  sdkPath: string;
  contentRoot: string;
  account: string;
  appId: number;
  depotId: number;
  description: string;
  branch?: string;
  preview: boolean;
}

/** Outcome returned by the native Steam publishing runner. */
export interface SteamPublishResult {
  status: 'previewed' | 'uploaded' | 'live-beta';
  appId: number;
  depotId: number;
  buildId?: string;
  branch?: string;
}

export interface OpenedProject {
  /** Absolute project directory on desktop; a synthetic id on web. */
  dir: string;
  name: string;
  /** Fully loaded project with asset `url`s resolved for the current platform. */
  project: NodeForgeProject;
}

export interface ProjectTextWriteOptions {
  /**
   * Compare-and-swap guard. The write proceeds only when the file still contains this exact text;
   * `null` means the file must still be missing.
   */
  expectedContents: string | null;
}

export type CollaborationJoinRole = 'editor' | 'viewer';

export interface StartCollaborationRequest {
  /** ngrok Agent authtoken. It is passed directly to the native agent and never persisted. */
  authtoken: string;
  sessionId: string;
  joinSecret: string;
  hostSecret: string;
  defaultRole: CollaborationJoinRole;
  /** Optional reserved/custom ngrok domain; free accounts normally leave this blank. */
  domain?: string;
}

export interface StartedCollaborationHost {
  localUrl: string;
  publicUrl: string;
  sessionId: string;
}

export interface CollaborationHostStatus {
  active: boolean;
  localUrl?: string;
  publicUrl?: string;
  sessionId?: string;
  participants: Array<{
    id: string;
    name: string;
    role: 'host' | CollaborationJoinRole;
  }>;
}

export interface CollaborationAssetRegistration {
  sha256: string;
  relativePath: string;
  contentType?: string;
}

export interface RegisteredCollaborationAsset {
  sha256: string;
  size: number;
  path: string;
}

export type ProjectTextWriteResult =
  | { kind: 'written' }
  | {
      kind: 'changed';
      /** Contents that prevented the write. `null` means the file disappeared. */
      currentContents: string | null;
      /** Rare race-recovery copy retained inside the project, when one was needed. */
      recoveryPath?: string;
    };

export interface Platform {
  readonly isDesktop: boolean;
  /** Create a new project on disk (desktop) or in memory (web). Returns null if cancelled. */
  createProject(name: string, scaffold: NodeForgeProject): Promise<OpenedProject | null>;
  /** Open an existing project (folder on desktop, file on web). Returns null if cancelled. */
  openProject(): Promise<OpenedProject | null>;
  /** Open a project from a known path/handle (used for "recent projects"). */
  openProjectAt(dir: string): Promise<OpenedProject | null>;
  /** Persist the project to its directory (desktop) or download it (web). */
  saveProject(dir: string, project: NodeForgeProject): Promise<void>;
  /** Copy an imported asset into the project and return its relative path + runtime url. */
  importAsset(dir: string, file: File): Promise<{ path: string; url: string }>;
  /** Resolve a stored relative asset path to a runtime url for rendering. */
  resolveAssetUrl(dir: string, path: string): string;
  /**
   * Desktop only: read a UTF-8 text file below `projectDir`. `relativePath` must not be absolute or
   * contain `.` / `..` path segments. Returns null when the file does not exist.
   */
  readProjectText?(projectDir: string, relativePath: string): Promise<string | null>;
  /**
   * Desktop only: write a UTF-8 text file below `projectDir`, creating its parent folders. The same
   * project-relative path restrictions as `readProjectText` apply. With `expectedContents`, a
   * concurrent external change is returned as `changed` and is never overwritten.
   */
  writeProjectText?(
    projectDir: string,
    relativePath: string,
    contents: string,
    options?: ProjectTextWriteOptions,
  ): Promise<ProjectTextWriteResult>;
  /**
   * Desktop only: watch one or more project-relative files/directories. The debounced callback
   * receives changed paths relative to the project, always using `/` separators. Resolves to a
   * cleanup function that stops the watcher.
   */
  watchProjectPaths?(
    projectDir: string,
    relativePaths: string[],
    onChange: (changedRelativePaths: string[]) => void,
    options?: { debounceMs?: number },
  ): Promise<() => void>;
  /** Desktop only: reveal one safe project-relative file or directory in the OS file manager. */
  revealProjectFile?(projectDir: string, relativePath: string): Promise<void>;
  /**
   * Write a standalone game bundle (the `game.json` the player loads).
   * Downloads the file on web; prompts for a save location on desktop.
   * Returns a short human-readable destination label, or null if cancelled.
   */
  exportGame(name: string, bundle: unknown): Promise<string | null>;
  /**
   * Stage a game bundle for a production build (portable web folder + native app).
   * On desktop, prompts for a save location and returns the absolute path of the
   * written `game.json` (so the caller can show the exact build command). On web,
   * downloads `game.json` and returns null.
   */
  stageProduction(name: string, bundle: unknown): Promise<string | null>;
  /**
   * Desktop only: actually run the production build for an already-built bundle, streaming each
   * output line via `onProgress`. Targets are exact and independent: web, windows, macos, linux,
   * android or ios. Desktop targets require their matching host OS; the platform doctor supplies
   * that readiness to the UI. Resolves to the artifact root. Undefined in the browser, where the
   * caller falls back to staging the canonical game bundle.
   */
  buildProduction?(request: ProductionBuildRequest, onProgress: (line: string) => void): Promise<string>;
  /**
   * Desktop only: run the platform doctor and report which export platforms this machine can
   * build right now (and what's missing for the rest). Undefined on web.
   */
  checkExportPlatforms?(): Promise<ExportPlatformsReport>;
  /** Desktop only: locate and validate SteamCMD inside a Steamworks SDK installation. */
  checkSteamTools?(sdkPath: string): Promise<SteamToolReport>;
  /** Desktop only: preview or upload one Steam depot build, streaming native progress output. */
  publishSteam?(
    request: SteamPublishRequest,
    onProgress: (line: string) => void,
  ): Promise<SteamPublishResult>;
  /** Desktop only: prompt for a folder. Returns the absolute path, or null if cancelled. */
  pickDirectory?(title?: string): Promise<string | null>;
  /**
   * Write a portable template/module package (`.nfpack`). Downloads on web; prompts for a save
   * location on desktop. Takes the already-serialized container bytes — the format (zip archive or
   * legacy JSON) is the caller's business, not the platform's. Returns a short destination label,
   * or null if cancelled.
   */
  exportPackage(name: string, bytes: Uint8Array): Promise<string | null>;
  /** Open a `.nfpack` file and return its raw bytes, or null if cancelled. */
  openPackage(): Promise<Uint8Array | null>;
  /**
   * Write arbitrary binary data (e.g. an exported MP4/WebM recording). On desktop, prompts for a
   * save location via a native "Save As" dialog and writes the bytes. On web, downloads via a blob
   * URL (the browser decides the folder). Returns a short destination label, or null if cancelled.
   */
  saveBinary(
    defaultName: string,
    bytes: Uint8Array,
    options?: { title?: string; mimeType?: string; filters?: { name: string; extensions: string[] }[] },
  ): Promise<string | null>;
  /**
   * Desktop only: write `bytes` into `<projectDir>/<subfolder>/<fileName>`, creating the subfolder
   * if missing. Used for "automation" outputs (cinematic recordings, screenshots, etc.) that should
   * live alongside the project on disk instead of forcing a Save-As prompt. Returns the absolute
   * path of the written file. Undefined on web (no project folder on disk).
   */
  saveInProject?(projectDir: string, subfolder: string, fileName: string, bytes: Uint8Array): Promise<string>;
  /**
   * Desktop only: open the OS file manager with the given file highlighted (Explorer on Windows,
   * Finder on macOS). No-op / unsupported on web — callers should fall back to telling the user to
   * check their browser's Downloads folder.
   */
  revealFile?(path: string): Promise<void>;
  /** Desktop only: start the local authenticated WebSocket relay and publish it through ngrok. */
  startCollaboration?(request: StartCollaborationRequest): Promise<StartedCollaborationHost>;
  /** Desktop host only: close the relay/tunnel and disconnect its participants. */
  stopCollaboration?(): Promise<void>;
  /** Desktop only: inspect the in-memory relay. No credential is included in this response. */
  collaborationStatus?(): Promise<CollaborationHostStatus>;
  /** Register already-hashed project files for authenticated guest transfer. */
  registerCollaborationAssets?(
    projectDir: string,
    assets: CollaborationAssetRegistration[],
  ): Promise<RegisteredCollaborationAsset[]>;
}
