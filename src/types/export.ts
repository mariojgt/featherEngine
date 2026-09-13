/** Version of the persisted export-settings schema. */
export const EXPORT_SETTINGS_VERSION = 1 as const;

/** OS-level targets presented by the editor and understood by the production builder. */
export const EXPORT_TARGET_IDS = ['web', 'windows', 'macos', 'linux', 'android', 'ios'] as const;

export type ExportTargetId = (typeof EXPORT_TARGET_IDS)[number];
export type ExportConfiguration = 'debug' | 'release';

export interface ExportApplicationSettings {
  /** Store/installer-facing application name. */
  productName: string;
  /** Stable reverse-DNS identity. Renaming a project must not silently change this. */
  identifier: string;
  /** User-facing semantic version. */
  version: string;
  /** Monotonic mobile/native build number. */
  buildNumber: number;
}

export interface ExportWindowSettings {
  title: string;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable: boolean;
  fullscreen: boolean;
}

/** One reusable build configuration, similar to Unity Build Profiles/Godot export presets. */
export interface ExportProfile {
  id: string;
  name: string;
  configuration: ExportConfiguration;
  targets: ExportTargetId[];
  /** Explicit launch scene; it is intentionally independent of the editor's currently-open scene. */
  startSceneId: string;
  application: ExportApplicationSettings;
  window: ExportWindowSettings;
  /** Ship the in-game diagnostics overlay and shortcut in development builds only. */
  includeDebugOverlay: boolean;
  /** Original authored files are retained; these options affect prepared build copies only. */
  optimization?: { geometry: boolean; textures: boolean; streamAssets: boolean };
}

export interface ExportSettings {
  version: typeof EXPORT_SETTINGS_VERSION;
  activeProfileId: string;
  profiles: ExportProfile[];
}
