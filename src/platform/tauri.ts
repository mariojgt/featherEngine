import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { join } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import {
  exists,
  lstat,
  mkdir,
  readFile,
  readTextFile,
  watch,
  writeFile,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { NodeForgeProject, ProjectManifest, Scene } from '../types';
import { ASSETS_DIR, SCENES_DIR, blankProject, joinProject, splitProject } from '../project/serialize';
import type {
  CollaborationHostStatus,
  OpenedProject,
  Platform,
  ProjectTextWriteResult,
  StartedCollaborationHost,
  RegisteredCollaborationAsset,
  SteamPublishResult,
  SteamToolReport,
} from './types';
import { canUseHostOnlyFeatures } from '../collaboration/access';

const MANIFEST = 'project.json';
const MAX_PROJECT_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_RELATIVE_PATH_LENGTH = 1024;
const MAX_WATCH_ROOTS = 128;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

/** Keep project-linked files inside the selected project, on every supported desktop OS. */
function safeProjectRelativePath(relativePath: string): string {
  const portable = relativePath.replace(/\\/g, '/');
  const parts = portable.split('/');
  const isAbsolute = portable.startsWith('/') || /^[A-Za-z]:/.test(portable);
  const hasUnsafeSegment = parts.some(
    (part) =>
      part === '' ||
      part === '.' ||
      part === '..' ||
      new TextEncoder().encode(part).byteLength > 240 ||
      /[\u0000-\u001f<>:"|?*]/.test(part) ||
      /[. ]$/.test(part) ||
      WINDOWS_RESERVED_NAME.test(part),
  );
  if (
    isAbsolute ||
    hasUnsafeSegment ||
    portable.length > MAX_PROJECT_RELATIVE_PATH_LENGTH
  ) {
    throw new Error(`Unsafe project-relative path: ${relativePath}`);
  }
  return parts.join('/');
}

async function absoluteProjectPath(projectDir: string, relativePath: string): Promise<string> {
  const safePath = safeProjectRelativePath(relativePath);
  return join(projectDir, ...safePath.split('/'));
}

/** Reject a static symlink/junction component before project-linked I/O follows it. */
async function assertNoProjectPathSymlinks(projectDir: string, relativePath: string): Promise<void> {
  const safePath = safeProjectRelativePath(relativePath);
  let current = projectDir;
  for (const part of safePath.split('/')) {
    current = await join(current, part);
    if (!(await exists(current))) continue;
    if ((await lstat(current)).isSymlink) {
      throw new Error(`Linked project path cannot contain a symbolic link: ${relativePath}`);
    }
  }
}

function assertProjectTextSize(contents: string): void {
  if (new TextEncoder().encode(contents).byteLength > MAX_PROJECT_TEXT_BYTES) {
    throw new Error('Linked project text files are limited to 4 MiB.');
  }
}

const windowsLikePath = (path: string): boolean => {
  const portable = path.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(portable) || portable.startsWith('//');
};

function trimTrailingSeparators(path: string): string {
  const portable = path.replace(/\\/g, '/');
  if (portable === '/' || /^[A-Za-z]:\/$/.test(portable)) return portable;
  return portable.replace(/\/+$/, '');
}

function pathWithinProject(projectDir: string, absolutePath: string): string | null {
  const project = trimTrailingSeparators(projectDir);
  const changed = trimTrailingSeparators(absolutePath);
  const prefix = project.endsWith('/') ? project : `${project}/`;
  const caseInsensitive = windowsLikePath(project);
  const comparableChanged = caseInsensitive ? changed.toLowerCase() : changed;
  const comparablePrefix = caseInsensitive ? prefix.toLowerCase() : prefix;
  if (!comparableChanged.startsWith(comparablePrefix)) return null;

  const relativePath = changed.slice(prefix.length);
  try {
    return safeProjectRelativePath(relativePath);
  } catch {
    return null;
  }
}

async function writeProjectFiles(dir: string, project: NodeForgeProject) {
  const { manifest, sceneFiles } = splitProject(project);
  await mkdir(await join(dir, SCENES_DIR), { recursive: true });
  await mkdir(await join(dir, ASSETS_DIR), { recursive: true });
  // Manifest stays pretty-printed (small, occasionally human-inspected). Scene files are machine
  // files and can be large (terrain heightmaps etc.) — skip the indentation to cut serialization
  // time and file size, and write them in parallel rather than one-await-at-a-time.
  await writeTextFile(await join(dir, MANIFEST), JSON.stringify(manifest, null, 2));
  await Promise.all(
    sceneFiles.map(async ({ scene }) =>
      writeTextFile(await join(dir, SCENES_DIR, `${scene.id}.scene.json`), JSON.stringify(scene)),
    ),
  );
}

async function readProjectDir(dir: string): Promise<OpenedProject> {
  const manifest = JSON.parse(await readTextFile(await join(dir, MANIFEST))) as ProjectManifest;
  // Scene file reads are independent — run them in parallel instead of sequentially.
  const scenes: Scene[] = await Promise.all(
    manifest.scenes.map(async (ref) => JSON.parse(await readTextFile(await join(dir, ref.file))) as Scene),
  );
  const project = joinProject(manifest, scenes);
  // Resolve asset urls from disk.
  project.assets = await Promise.all(
    project.assets.map(async (asset) =>
      asset.path
        ? { ...asset, url: convertFileSrc(await join(dir, asset.path)) }
        : { ...asset, unresolved: true },
    ),
  );
  return { dir, name: manifest.name, project };
}

export const tauriPlatform: Platform = {
  isDesktop: true,

  async createProject(name, scaffold) {
    const parent = await open({ directory: true, multiple: false, title: 'Choose where to create the project' });
    if (typeof parent !== 'string') return null;
    const dir = await join(parent, name);
    await mkdir(dir, { recursive: true });
    const project = { ...blankProject(name), ...scaffold, name };
    await writeProjectFiles(dir, project);
    return { dir, name, project };
  },

  async openProject() {
    const dir = await open({ directory: true, multiple: false, title: 'Open Feather project' });
    if (typeof dir !== 'string') return null;
    return this.openProjectAt(dir);
  },

  async openProjectAt(dir) {
    if (!(await exists(await join(dir, MANIFEST)))) {
      throw new Error('No project.json found in that folder.');
    }
    return readProjectDir(dir);
  },

  async saveProject(dir, project) {
    if (!canUseHostOnlyFeatures()) throw new Error('Only the collaboration host can save the shared project.');
    await writeProjectFiles(dir, project);
  },

  async importAsset(dir, file) {
    if (!canUseHostOnlyFeatures()) throw new Error('Only the collaboration host can import project assets.');
    const assetsDir = await join(dir, ASSETS_DIR);
    await mkdir(assetsDir, { recursive: true });
    const safeName = file.name.replace(/[^\w.\-]+/g, '_');
    const abs = await join(assetsDir, safeName);
    await writeFile(abs, new Uint8Array(await file.arrayBuffer()));
    return { path: `${ASSETS_DIR}/${safeName}`, url: convertFileSrc(abs) };
  },

  resolveAssetUrl(_dir, path) {
    // Assets are resolved to absolute urls at load time (readProjectDir); this is a fallback.
    return convertFileSrc(path);
  },

  async readProjectText(projectDir, relativePath) {
    if (!canUseHostOnlyFeatures()) throw new Error('Linked FeatherScript files are controlled by the collaboration host.');
    const safePath = safeProjectRelativePath(relativePath);
    await assertNoProjectPathSymlinks(projectDir, safePath);
    return invoke<string | null>('read_project_text', {
      projectDir,
      relativePath: safePath,
    });
  },

  async writeProjectText(projectDir, relativePath, contents, options) {
    if (!canUseHostOnlyFeatures()) throw new Error('Linked FeatherScript files are controlled by the collaboration host.');
    const safePath = safeProjectRelativePath(relativePath);
    assertProjectTextSize(contents);
    if (options?.expectedContents !== null && options?.expectedContents !== undefined) {
      assertProjectTextSize(options.expectedContents);
    }
    return invoke<ProjectTextWriteResult>('write_project_text_atomic', {
      projectDir,
      relativePath: safePath,
      contents,
      checkExpected: options !== undefined,
      expectedContents: options?.expectedContents ?? null,
    });
  },

  async watchProjectPaths(projectDir, relativePaths, onChange, options) {
    if (!canUseHostOnlyFeatures()) throw new Error('Linked FeatherScript files are controlled by the collaboration host.');
    if (relativePaths.length === 0) {
      throw new Error('At least one project-relative path is required to start a watcher.');
    }
    if (relativePaths.length > MAX_WATCH_ROOTS) {
      throw new Error(`No more than ${MAX_WATCH_ROOTS} project paths can be watched at once.`);
    }

    const watchedRelativePaths = [...new Set(relativePaths.map(safeProjectRelativePath))];
    await Promise.all(
      watchedRelativePaths.map((relativePath) =>
        assertNoProjectPathSymlinks(projectDir, relativePath),
      ),
    );
    const watchedAbsolutePaths = await Promise.all(
      watchedRelativePaths.map((relativePath) => absoluteProjectPath(projectDir, relativePath)),
    );
    const requestedDelay = options?.debounceMs ?? 250;
    const delayMs = Number.isFinite(requestedDelay)
      ? Math.round(Math.min(60_000, Math.max(50, requestedDelay)))
      : 250;
    const caseInsensitive = windowsLikePath(projectDir);

    return watch(
      watchedAbsolutePaths,
      (event) => {
        const changedRelativePaths = [
          ...new Set(
            event.paths
              .map((path) => pathWithinProject(projectDir, path))
              .filter((path): path is string => path !== null)
              .filter((path) => {
                const comparablePath = caseInsensitive ? path.toLowerCase() : path;
                return watchedRelativePaths.some((watchedPath) => {
                  const comparableWatched = caseInsensitive
                    ? watchedPath.toLowerCase()
                    : watchedPath;
                  return (
                    comparablePath === comparableWatched ||
                    comparablePath.startsWith(`${comparableWatched}/`)
                  );
                });
              }),
          ),
        ];
        if (changedRelativePaths.length > 0) onChange(changedRelativePaths);
      },
      { delayMs, recursive: false },
    );
  },

  async revealProjectFile(projectDir, relativePath) {
    if (!canUseHostOnlyFeatures()) throw new Error('Linked FeatherScript files are controlled by the collaboration host.');
    await assertNoProjectPathSymlinks(projectDir, relativePath);
    const target = await absoluteProjectPath(projectDir, relativePath);
    await invoke('reveal_in_explorer', { path: target });
  },

  async exportGame(_name, bundle) {
    const target = await save({
      title: 'Export game bundle',
      defaultPath: 'game.json',
      filters: [{ name: 'Game bundle', extensions: ['json'] }],
    });
    if (typeof target !== 'string') return null;
    // Compact (no pretty-print) — bundles inline asset data and get large.
    await writeTextFile(target, JSON.stringify(bundle));
    return target;
  },

  async stageProduction(_name, bundle) {
    const target = await save({
      title: 'Stage game for production build',
      defaultPath: 'game.json',
      filters: [{ name: 'Game bundle', extensions: ['json'] }],
    });
    if (typeof target !== 'string') return null;
    // Compact (no pretty-print) — production bundles inline asset data and get large.
    await writeTextFile(target, JSON.stringify(bundle));
    return target;
  },

  async buildProduction(request, onProgress) {
    const unlisten = await listen<string>('production-build-progress', (event) =>
      onProgress(event.payload),
    );
    try {
      return await invoke<string>('run_production_build', {
        bundleJson: request.bundleJson,
        profileJson: JSON.stringify(request.profile),
        targets: request.targets,
        outDir: request.outDir,
      });
    } finally {
      unlisten();
    }
  },

  async checkExportPlatforms() {
    const raw = await invoke<string>('check_export_platforms');
    return JSON.parse(raw);
  },

  async checkSteamTools(sdkPath) {
    return invoke<SteamToolReport>('check_steam_tools', { sdkPath });
  },

  async publishSteam(request, onProgress) {
    const unlisten = await listen<string>('steam-publish-progress', (event) =>
      onProgress(event.payload),
    );
    try {
      return await invoke<SteamPublishResult>('run_steam_publish', { request });
    } finally {
      unlisten();
    }
  },

  async pickDirectory(title) {
    const dir = await open({ directory: true, multiple: false, title: title ?? 'Choose a folder' });
    return typeof dir === 'string' ? dir : null;
  },

  async exportPackage(name, bytes) {
    const safe = (name || 'package').replace(/[^\w.\-]+/g, '_');
    const target = await save({
      title: 'Export package',
      defaultPath: `${safe}.nfpack`,
      filters: [{ name: 'NodeForge package', extensions: ['nfpack', 'json'] }],
    });
    if (typeof target !== 'string') return null;
    await writeFile(target, bytes);
    return target;
  },

  async openPackage() {
    const target = await open({
      multiple: false,
      title: 'Import package',
      filters: [{ name: 'NodeForge package', extensions: ['nfpack', 'json'] }],
    });
    if (typeof target !== 'string') return null;
    return await readFile(target);
  },

  async saveBinary(defaultName, bytes, options) {
    const target = await save({
      title: options?.title ?? 'Save file',
      defaultPath: defaultName,
      filters: options?.filters,
    });
    if (typeof target !== 'string') return null;
    await writeFile(target, bytes);
    return target;
  },

  async revealFile(path) {
    await invoke('reveal_in_explorer', { path });
  },

  async saveInProject(projectDir, subfolder, fileName, bytes) {
    if (!canUseHostOnlyFeatures()) throw new Error('Only the collaboration host can write project files.');
    const dir = await join(projectDir, subfolder);
    await mkdir(dir, { recursive: true });
    const target = await join(dir, fileName);
    await writeFile(target, bytes);
    return target;
  },

  async startCollaboration(request) {
    return invoke<StartedCollaborationHost>('start_collaboration', { ...request });
  },

  async stopCollaboration() {
    await invoke('stop_collaboration');
  },

  async collaborationStatus() {
    return invoke<CollaborationHostStatus>('collaboration_status');
  },

  async registerCollaborationAssets(projectDir, assets) {
    return invoke<RegisteredCollaborationAsset[]>('register_collaboration_assets', {
      projectDir,
      assets,
    });
  },
};
