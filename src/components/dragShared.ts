/**
 * Shared state for dragging a project-browser asset into the 3D viewport.
 *
 * `dataTransfer` custom MIME types are unreliable in some webviews — notably the Tauri
 * WKWebView, which hides custom types during `dragover`, so the drop zone can't tell a
 * valid drag is in progress and never calls preventDefault(). We therefore also stash the
 * dragged asset id in this module-level holder, which both the browser (writer) and the
 * viewport (reader) can access directly. Cleared on dragend/drop.
 */
export const ASSET_DRAG_TYPE = 'application/x-feather-asset';

export const assetDrag: { id: string | null } = { id: null };

export function hasDragType(dataTransfer: DataTransfer | null | undefined, type: string) {
  return Array.from(dataTransfer?.types ?? []).includes(type);
}

export function isAssetDrag(dataTransfer: DataTransfer | null | undefined) {
  return Boolean(assetDrag.id) || hasDragType(dataTransfer, ASSET_DRAG_TYPE);
}

export function readAssetDragId(dataTransfer: DataTransfer | null | undefined) {
  try {
    return dataTransfer?.getData(ASSET_DRAG_TYPE) || assetDrag.id;
  } catch {
    return assetDrag.id;
  }
}
