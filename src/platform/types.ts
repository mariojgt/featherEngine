import type { NodeForgeProject } from '../types';

export interface OpenedProject {
  /** Absolute project directory on desktop; a synthetic id on web. */
  dir: string;
  name: string;
  /** Fully loaded project with asset `url`s resolved for the current platform. */
  project: NodeForgeProject;
}

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
   * Write a standalone game bundle (the `game.json` the player loads).
   * Downloads the file on web; prompts for a save location on desktop.
   * Returns a short human-readable destination label, or null if cancelled.
   */
  exportGame(name: string, bundle: unknown): Promise<string | null>;
}
