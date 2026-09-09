import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankProject } from '../../project/serialize';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { useModelThumbnails } from '../../store/modelThumbnailStore';
import { AssetBrowser } from '../AssetBrowser';
import { ASSET_DRAG_TYPE, MATERIAL_DRAG_TYPE, PREFAB_DRAG_TYPE, assetDrag, materialDrag, prefabDrag } from '../dragShared';
import type { AssetItem } from '../../types';

const { importAsset, confirmAction, importPackageFromFile } = vi.hoisted(() => ({
  importAsset: vi.fn(async (_dir: string, file: File) => ({ path: `assets/${file.name}`, url: `blob:${file.name}` })),
  confirmAction: vi.fn(async () => true),
  importPackageFromFile: vi.fn(async () => undefined),
}));
vi.mock('../../platform', () => ({ getPlatform: async () => ({ importAsset }) }));
vi.mock('../../store/confirmStore', () => ({ confirmAction }));
vi.mock('../SkeletonEditorModal', () => ({ SkeletonEditorModal: () => <div role="dialog">Skeleton editor</div> }));
vi.mock('../../three/convertModel', () => ({ fbxToGlb: vi.fn() }));
vi.mock('../../three/compressTextures', () => ({ compressGlbTextures: vi.fn() }));
vi.mock('../../three/inspectModel', () => ({ inspectModel: vi.fn() }));

const editor = () => useEditorStore.getState();
const asset = (id: string, name: string, type: AssetItem['type'], folderId?: string): AssetItem => ({
  id, name, type, folderId, size: 2048, url: `blob:${id}`, createdAt: 0,
});

describe('AssetBrowser interactions', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterAll(() => {
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });
  beforeEach(() => {
    vi.clearAllMocks();
    editor().loadProject(blankProject('Asset browser test'));
    useEditorStore.setState({ assetSearch: '', assets: [], blueprints: [], folders: [], materials: [], particleSystems: [], dataAssets: [], uiDocuments: [], skeletons: [], skeletalMeshes: [], animations: [], animatorControllers: [], prefabs: [] });
    useModelThumbnails.setState({ thumbnails: {}, queue: [] });
    useProjectStore.setState({ projectDir: '/project', importPackageFromFile });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    assetDrag.id = null;
    materialDrag.id = null;
    prefabDrag.id = null;
  });

  const render = () => act(() => root.render(<AssetBrowser />));
  const find = <T extends HTMLElement = HTMLElement>(selector: string, scope: ParentNode = container): T => {
    const element = scope.querySelector<T>(selector);
    expect(element, selector).not.toBeNull();
    return element!;
  };
  const click = (element: HTMLElement, modifiers: MouseEventInit = {}) => act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, ...modifiers }));
  });
  const button = (name: string, scope: ParentNode = document) => {
    const element = [...scope.querySelectorAll<HTMLElement>('button')].find((item) => item.getAttribute('aria-label') === name || item.textContent?.trim() === name || item.querySelector('strong')?.textContent === name);
    expect(element, name).toBeDefined();
    return element!;
  };
  const fill = (input: HTMLInputElement, value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const filter = (value: string) => act(() => {
    const select = find<HTMLSelectElement>('select[aria-label="Filter assets by type"]');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const dragEvent = (element: HTMLElement, type: string, dataTransfer: object) => act(() => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    element.dispatchEvent(event);
  });

  it('searches all folders by name, combines the type filter, and clears search on folder navigation', () => {
    useEditorStore.setState({ folders: [{ id: 'characters', name: 'Characters' }], assets: [asset('model', 'Hero.glb', 'model', 'characters'), asset('image', 'Hero.png', 'image'), asset('audio', 'Theme.wav', 'audio')] });
    render();
    expect(container.querySelector('[data-key="asset:model"]')).toBeNull();
    fill(find('input[aria-label="Search all assets"]'), '  HERO  ');
    expect(find('[data-key="asset:model"]').textContent).toContain('Project / Characters');
    expect(container.textContent).toContain('All folders');
    expect(container.querySelectorAll('[data-key]')).toHaveLength(2);
    filter('model');
    expect(container.querySelectorAll('[data-key]')).toHaveLength(1);
    filter('audio');
    expect(container.textContent).toContain('No matching assets');
    click(button('Clear search and filters'));
    expect(editor().assetSearch).toBe('');
    fill(find('input[aria-label="Search all assets"]'), 'Hero');
    click(find('.asset-folders [aria-label="Open folder Characters"]'));
    expect(editor().assetSearch).toBe('');
    expect(container.querySelectorAll('[data-key]')).toHaveLength(1);
    expect(find('[data-key="asset:model"]').textContent).toContain('Model');
  });

  it('selects a prefab without opening or placing it, and places only with Add to Scene', () => {
    const sourceId = editor().createObjectWithProps('cube', { name: 'Crate' });
    const prefabId = editor().createPrefabFromObject(sourceId, 'Crate prefab')!;
    const before = selectActiveObjects(editor()).length;
    render();
    click(find(`[data-key="prefab:${prefabId}"]`));
    expect(editor().editingPrefabId).toBeFalsy();
    expect(selectActiveObjects(editor())).toHaveLength(before);
    expect(find(`[data-key="prefab:${prefabId}"]`).getAttribute('aria-pressed')).toBe('true');
    expect(find('.asset-selection-bar').textContent).toContain('Drag into the viewport to place');
    click(button('Add to Scene', find('.asset-selection-bar')));
    expect(selectActiveObjects(editor())).toHaveLength(before + 1);
    expect(editor().editingPrefabId).toBeFalsy();
    click(button('Open prefab'));
    expect(editor().editingPrefabId).toBe(prefabId);
  });

  it('selects derived resources consistently and opens an editor only deliberately', () => {
    useEditorStore.setState({ skeletons: [{ id: 'rig', name: 'Hero rig', sourceAssetId: 'model', boneNames: ['Root'], signature: 'hero-rig', rootBone: 'Root', createdAt: 0 }] });
    render();
    click(find('[data-key="skeleton:rig"]'));
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(find('[data-key="skeleton:rig"]').getAttribute('aria-pressed')).toBe('true');
    click(button('Open editor'));
    expect(container.textContent).toContain('Skeleton editor');
  });

  it('creates a resource in the current folder through disclosure and keeps rename focused across keystrokes', () => {
    useEditorStore.setState({ folders: [{ id: 'library', name: 'Library' }] });
    render();
    click(find('.asset-folders [aria-label="Open folder Library"]'));
    filter('audio');
    expect(document.querySelector('.asset-browser-popover')).toBeNull();
    click(button('Create resource'));
    expect(document.querySelector('.asset-browser-popover')?.textContent).toContain('Create in Project / Library');
    click(button('Material', find('.asset-browser-popover', document)));
    expect(editor().materials).toHaveLength(1);
    expect(editor().materials[0].folderId).toBe('library');
    expect(find<HTMLSelectElement>('select').value).toBe('all');
    const input = find<HTMLInputElement>('input[aria-label="Rename item"]');
    fill(input, 'Stone');
    expect(document.activeElement).toBe(input);
    fill(input, 'Stone wall');
    expect(document.activeElement).toBe(input);
    act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(editor().materials[0].name).toBe('Stone wall');
    expect(document.querySelector('.asset-browser-popover')).toBeNull();
  });

  it('retains model, material, prefab and particle viewport drag payloads', () => {
    useEditorStore.setState({ assets: [asset('model', 'Hero.glb', 'model')] });
    const materialId = editor().createMaterial('Stone');
    const systemId = editor().createParticleSystem('Fire');
    const sourceId = editor().createObjectWithProps('cube', { name: 'Crate' });
    const prefabId = editor().createPrefabFromObject(sourceId, 'Crate prefab')!;
    render();
    for (const [kind, id, mime, holder] of [
      ['asset', 'model', ASSET_DRAG_TYPE, assetDrag], ['material', materialId, MATERIAL_DRAG_TYPE, materialDrag],
      ['prefab', prefabId, PREFAB_DRAG_TYPE, prefabDrag], ['particleSystem', systemId, ASSET_DRAG_TYPE, assetDrag],
    ] as const) {
      const transfer = { setData: vi.fn(), setDragImage: vi.fn(), effectAllowed: '' };
      const item = find(`[data-key="${kind}:${id}"]`);
      dragEvent(item, 'dragstart', transfer);
      expect(transfer.setData).toHaveBeenCalledWith(mime, id);
      expect(holder.id).toBe(id);
      expect(transfer.effectAllowed).toBe('copyMove');
      dragEvent(item, 'dragend', transfer);
      expect(holder.id).toBeNull();
    }
  });

  it('preserves range selection and folder moves, then clears hidden selection when filtering', () => {
    useEditorStore.setState({ folders: [{ id: 'library', name: 'Library' }], assets: [asset('one', 'One.png', 'image'), asset('two', 'Two.png', 'image'), asset('three', 'Three.wav', 'audio')] });
    render();
    click(find('[data-key="asset:one"]'));
    click(find('[data-key="asset:three"]'), { shiftKey: true });
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(3);
    const transfer = { setData: vi.fn(), setDragImage: vi.fn(), files: [] };
    dragEvent(find('[data-key="asset:one"]'), 'dragstart', transfer);
    dragEvent(find('.folder-tile'), 'drop', transfer);
    expect(editor().assets.every((item) => item.folderId === 'library')).toBe(true);
    click(find('.asset-folders [aria-label="Open folder Library"]'));
    click(find('[data-key="asset:one"]'));
    filter('audio');
    expect(container.querySelectorAll('[data-key][aria-pressed="true"]')).toHaveLength(0);
    expect(container.querySelector('.asset-selection-bar')?.textContent ?? '').not.toContain('One.png');
    click(button('Switch to list view'));
    expect(find('[data-key="asset:three"]').textContent).toContain('Audio · 2.0 KB');
  });

  it('imports through the labeled picker into the current folder and imports dropped files only once', async () => {
    useEditorStore.setState({ folders: [{ id: 'library', name: 'Library' }] });
    render();
    click(find('.asset-folders [aria-label="Open folder Library"]'));
    const input = find<HTMLInputElement>('input[type="file"]');
    const picker = vi.spyOn(input, 'click');
    click(button('Import assets', find('.asset-browser-actions')));
    expect(picker).toHaveBeenCalledOnce();
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['image'], 'Picker.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(editor().assets).toHaveLength(1);
    expect(editor().assets[0]).toMatchObject({ name: 'Picker.png', folderId: 'library' });
    click(find('.asset-folders [aria-label="Open project folder"]'));
    await act(async () => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files: [new File(['image'], 'Dropped.png', { type: 'image/png' })], types: ['Files'] } });
      find('.folder-tile').dispatchEvent(event);
    });
    expect(importAsset).toHaveBeenCalledTimes(2);
    expect(editor().assets).toHaveLength(2);
    expect(editor().assets[1]).toMatchObject({ name: 'Dropped.png', folderId: 'library' });
    expect(find<HTMLDetailsElement>('.model-import-report').open).toBe(false);
  });

  it('keeps package import and texture compression in options and falls back from a failed model preview', async () => {
    useEditorStore.setState({ assets: [asset('model', 'Hero.glb', 'model')] });
    useModelThumbnails.setState({ thumbnails: { model: '' } });
    render();
    expect(find('[data-key="asset:model"]').querySelector('.skeleton')).toBeNull();
    click(button('Asset browser options'));
    const compression = editor().renderSettings.compressTextures !== false;
    click(button(`Compress model textures: ${compression ? 'On' : 'Off'}`));
    expect(editor().renderSettings.compressTextures).toBe(!compression);
    await act(async () => { button('Import package…').click(); });
    expect(confirmAction).toHaveBeenCalledOnce();
    expect(importPackageFromFile).toHaveBeenCalledOnce();
  });
});
