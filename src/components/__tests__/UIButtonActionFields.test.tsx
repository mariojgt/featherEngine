import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../workspacePanels', () => ({ focusWorkspacePanel: vi.fn() }));
import { UIButtonActionFields } from '../UIButtonActionFields';
import { useEditorStore } from '../../store/editorStore';
import { blankProject } from '../../project/serialize';
import { findUIElement } from '../../store/editor/ui';
import { focusWorkspacePanel } from '../workspacePanels';
let root: Root, container: HTMLDivElement, docId: string, elementId: string, target: string;
const state = () => useEditorStore.getState();
const button = (name: string) => [...container.querySelectorAll('button')].find(b => b.textContent === name)!;
function Harness() {
  const doc = useEditorStore(s => s.uiDocuments.find(d => d.id === docId)!);
  return <UIButtonActionFields doc={doc} element={findUIElement(doc.root, elementId)!} />;
}
function choose(label: string, value: string) {
  act(() => { const select = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement; select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state().loadProject(blankProject('UI test'));
  docId = state().createUIDocument('Menu', 'screen'); elementId = state().addUIElement(docId, undefined, 'button'); target = state().createUIDocument('Settings', 'screen');
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  act(() => root.render(<Harness />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); state().setPlaying(false); delete (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT; });
it('requires a valid screen before Apply and reveals the generated event with Show logic', () => {
  choose('Button action', 'showUI'); expect(button('Apply action').disabled).toBe(true);
  choose('Action screen', target); expect(button('Apply action').disabled).toBe(false);
  act(() => button('Apply action').click());
  expect(button('Apply action').disabled).toBe(true);
  act(() => button('Show logic').click());
  const doc = state().uiDocuments.find(d => d.id === docId)!, element = findUIElement(doc.root, elementId)!;
  expect(state().selectedGraphNodeId).toBe(element.clickAction!.nodeIds[0]); expect(state().uiEditorMode).toBe('logic');
  expect(focusWorkspacePanel).toHaveBeenCalledWith('ui');
  // Mounting the graph must not clear that navigation selection.
  act(() => state().openUILogic(docId)); expect(state().selectedGraphNodeId).toBe(element.clickAction!.nodeIds[0]);
});
it('shows a deleted target and disables changes during Play', () => {
  choose('Button action', 'showUI'); choose('Action screen', target); act(() => button('Apply action').click());
  act(() => state().deleteUIDocument(target));
  expect(container.textContent).toContain('Missing screen'); expect(container.textContent).toContain('screen is missing');
  act(() => state().setPlaying(true)); expect(container.querySelector('fieldset')!.disabled).toBe(true); expect(container.textContent).toContain('Stop Play');
});
