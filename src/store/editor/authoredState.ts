import type { EditorState } from '../editorStore';

/** Authoring slices are immutable. Runtime, selection, logs and layout are deliberately excluded. */
const AUTHORED_KEYS = ['scenes', 'assets', 'folders', 'variables', 'dataAssets', 'materials', 'particleSystems',
  'skeletons', 'skeletalMeshes', 'animations', 'animatorControllers', 'uiDocuments', 'blueprints', 'graphs',
  'prefabs', 'treeSpecs', 'modelSpecs', 'renderSettings', 'exportSettings', 'activeSceneId'] as const;

export function authoredProjectChanged(previous: EditorState, next: EditorState): boolean {
  return AUTHORED_KEYS.some((key) => previous[key] !== next[key]);
}
