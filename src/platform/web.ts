import type { NodeForgeProject } from '../types';
import { migrateLoaded } from '../project/serialize';
import type { OpenedProject, Platform } from './types';

const WEB_DIR = 'web';

function downloadJson(fileName: string, data: unknown, pretty = true) {
  // Game bundles inline asset data and get large — write those compactly.
  const blob = new Blob([pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function download(name: string, project: NodeForgeProject) {
  downloadJson(name.endsWith('.nforge') ? name : `${name}.nforge`, project);
}

function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.nforge,.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

/**
 * Browser fallback: projects live in memory; Save downloads a single .nforge file and Open
 * reads one back. Assets stay as blob URLs (not persisted). The desktop app is the full product.
 */
export const webPlatform: Platform = {
  isDesktop: false,

  async createProject(name, scaffold) {
    return { dir: WEB_DIR, name, project: { ...scaffold, name } };
  },

  async openProject() {
    const file = await pickFile();
    if (!file) return null;
    const project = migrateLoaded(JSON.parse(await file.text()));
    return { dir: WEB_DIR, name: project.name, project };
  },

  async openProjectAt() {
    // No persistent handles on web.
    return null;
  },

  async saveProject(_dir, project) {
    download(project.name, project);
  },

  async importAsset(_dir, file) {
    return { path: `assets/${file.name}`, url: URL.createObjectURL(file) };
  },

  resolveAssetUrl() {
    return '';
  },

  async exportGame(name, bundle) {
    downloadJson('game.json', bundle, false);
    return `${name} downloaded as game.json`;
  },

  async stageProduction(_name, bundle) {
    // No local filesystem on web — download the bundle; the build script picks it up.
    downloadJson('game.json', bundle, false);
    return null;
  },

  async exportPackage(name, pkg) {
    const safe = name.replace(/[^\w.\-]+/g, '_') || 'package';
    downloadJson(`${safe}.nfpack`, pkg);
    return `${name} downloaded as ${safe}.nfpack`;
  },

  async openPackage() {
    const file = await pickPackageFile();
    if (!file) return null;
    return JSON.parse(await file.text());
  },

  async saveBinary(defaultName, bytes, options) {
    const blob = new Blob([bytes], { type: options?.mimeType ?? 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = defaultName;
    anchor.click();
    URL.revokeObjectURL(url);
    return `downloaded as ${defaultName}`;
  },
};

function pickPackageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.nfpack,.json,application/json';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
