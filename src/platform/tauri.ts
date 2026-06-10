import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { join } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readTextFile, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import type { NodeForgeProject, ProjectManifest, Scene } from '../types';
import { ASSETS_DIR, SCENES_DIR, blankProject, joinProject, splitProject } from '../project/serialize';
import type { OpenedProject, Platform } from './types';

const MANIFEST = 'project.json';

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
    await writeProjectFiles(dir, project);
  },

  async importAsset(dir, file) {
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

  async buildProduction(bundleJson, native, onProgress, outDir) {
    const unlisten = await listen<string>('production-build-progress', (event) =>
      onProgress(event.payload),
    );
    try {
      return await invoke<string>('run_production_build', { bundleJson, native, outDir });
    } finally {
      unlisten();
    }
  },

  async pickDirectory(title) {
    const dir = await open({ directory: true, multiple: false, title: title ?? 'Choose a folder' });
    return typeof dir === 'string' ? dir : null;
  },

  async exportPackage(name, pkg) {
    const safe = (name || 'package').replace(/[^\w.\-]+/g, '_');
    const target = await save({
      title: 'Export package',
      defaultPath: `${safe}.nfpack`,
      filters: [{ name: 'NodeForge package', extensions: ['nfpack', 'json'] }],
    });
    if (typeof target !== 'string') return null;
    await writeTextFile(target, JSON.stringify(pkg));
    return target;
  },

  async openPackage() {
    const target = await open({
      multiple: false,
      title: 'Import package',
      filters: [{ name: 'NodeForge package', extensions: ['nfpack', 'json'] }],
    });
    if (typeof target !== 'string') return null;
    return JSON.parse(await readTextFile(target));
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
    const dir = await join(projectDir, subfolder);
    await mkdir(dir, { recursive: true });
    const target = await join(dir, fileName);
    await writeFile(target, bytes);
    return target;
  },
};
