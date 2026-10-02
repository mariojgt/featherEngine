import { PROJECT_VERSION } from '../types';

/** Check compatibility before normalization can stamp an older editor's version onto newer data. */
export function assertSupportedProjectVersion(raw: unknown): void {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Unrecognized project file format.');
  const version = (raw as { version?: unknown }).version;
  if (version === undefined) return; // Early single-scene projects did not always carry a version.
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('The project file has an invalid format version.');
  }
  const requested = version.split('.').map(Number);
  const current = PROJECT_VERSION.split('.').map(Number);
  if (requested.some((value) => !Number.isSafeInteger(value))) throw new Error('The project file has an invalid format version.');
  for (let index = 0; index < 3; index += 1) {
    if (requested[index] > current[index]) {
      throw new Error(`This project uses format ${version}; this Feather supports ${PROJECT_VERSION}. Update Feather before opening it.`);
    }
    if (requested[index] < current[index]) return;
  }
}

/** Validate the shared containers before applying defaults. Component-specific checks stay in their loaders. */
export function assertProjectContainers(raw: Record<string, unknown>): void {
  for (const key of ['assets', 'folders', 'variables', 'dataAssets', 'dataTables', 'materials', 'particleSystems',
    'skeletons', 'skeletalMeshes', 'animations', 'animatorControllers', 'uiDocuments', 'blueprints', 'graphs',
    'prefabs', 'treeSpecs', 'modelSpecs']) {
    if (raw[key] != null && !Array.isArray(raw[key])) throw new Error(`The project file's ${key} must be an array.`);
  }
  if (Array.isArray(raw.scenes)) {
    const ids = new Set<string>();
    for (const entry of raw.scenes) {
      if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !entry.id || !Array.isArray(entry.objects)) {
        throw new Error('The project file contains an invalid scene. Each scene needs an id and an objects array.');
      }
      if (ids.has(entry.id)) throw new Error(`The project file contains duplicate scene id: ${entry.id}`);
      ids.add(entry.id);
    }
  }
}
