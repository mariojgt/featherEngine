import { createRoot } from 'react-dom/client';
import { useEditorStore, defaultCharacter, selectActiveObjects } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { mapActiveSceneObjects } from '../store/editor/storeHelpers';
import { RuntimeOverlays } from '../runtime/RuntimeOverlays';
import { GameView } from '../player/GameView';
import { blankProject } from '../project/serialize';
import { configureCinematicCapture, renderCinematicCaptureFrame } from '../runtime/cinematicCapture';
import { useGameRuntime } from '../runtime/useGameRuntime';
import { useRuntimeAudio } from '../runtime/useRuntimeAudio';
import { useSyncExternalStore } from 'react';
import { extensionRegistry, startExtensionHost } from '../extensions/host';
import { usePluginStore } from '../store/pluginStore';
import { mouseLook } from '../runtime/mouseLook';
import { cinderfallModelDefinitions } from '../project/cinderfallArt';
import type { Vector3Tuple } from '../types';
import '../styles.css';

if (!import.meta.env.DEV) throw new Error('Store capture requires the development server.');
const params = new URLSearchParams(location.search), slug = params.get('slug') ?? '', kind = params.get('kind') ?? 'project';
const s = useEditorStore, p = useProjectStore;
configureCinematicCapture(true);
let frozen = false, last = performance.now();
Object.assign(window, {
  __featherStore: new Proxy({}, { get: (_, key: keyof ReturnType<typeof s.getState>) => s.getState()[key] }),
  __featherProject: new Proxy({}, { get: (_, key: keyof ReturnType<typeof p.getState>) => p.getState()[key] }),
  __storeCapture: {
    freeze: (value: boolean) => { frozen = value; },
    render: async () => {
      const deadline = performance.now() + 40000;
      while (performance.now() < deadline) {
        try { await renderCinematicCaptureFrame(); return; }
        catch (error) {
          if (!(error instanceof Error) || !error.message.includes('not mounted')) throw error;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      throw new Error('Store preview renderer did not become ready.');
    },
    aim: (yaw: number, pitch: number) => {
      const pawn = selectActiveObjects(s.getState()).find(object => object.character?.cameraFollow);
      if (!pawn?.character) return;
      mouseLook.dx = -yaw / pawn.character.mouseSensitivity;
      mouseLook.dy = (pawn.character.cameraPitch - pitch) / pawn.character.mouseSensitivity;
    },
    showDocument: (id: string) => s.setState({ runtimeVisibleUI: Object.fromEntries(s.getState().uiDocuments.map(doc => [doc.id, doc.id === id])) }),
    hideDocuments: () => s.setState({ runtimeVisibleUI: {} }),
    prepareAssetDisplay: () => {
      const state = s.getState();
      for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-camera', 'obj-light']) state.deleteObject(id);
      const floor = state.createObjectWithProps('cube', { name: 'Preview ground', position: [0, -0.16, 0], color: '#263340' });
      state.updateTransform(floor, 'scale', [30, 0.2, 20]);
      state.updateSceneEnvironment(state.activeSceneId, { skyMode: 'color', backgroundColor: '#101a26', environmentIntensity: 1, sunIntensity: 1.7, sunElevation: 45, fogEnabled: false });
      const prefabs = state.prefabs.slice(0, 6);
      prefabs.forEach((prefab, index) => state.instantiatePrefab(prefab.id, { position: [(index - (prefabs.length - 1) / 2) * 3.3, 0, 0] }));
      if (!prefabs.length) {
        const models = state.assets.filter(asset => asset.type === 'model').slice(0, 4);
        models.forEach((asset, index) => { const id = state.createObjectWithProps('cube', { name: asset.name, position: [(index - (models.length - 1) / 2) * 3.3, 0, 0] }); state.setObjectModel(id, asset.id); });
        if (!models.length) state.materials.slice(0, 6).forEach((material, index) => { const id = state.createObjectWithProps('sphere', { name: material.name, position: [(index - 2.5) * 2, 0.8, 0] }); state.setObjectMaterial(id, material.id); state.updateTransform(id, 'scale', [1.6, 1.6, 1.6]); });
      }
    },
    frame: (position: Vector3Tuple, target: Vector3Tuple, fov = 50) => {
      const state = s.getState(), id = 'store-capture-camera';
      if (!selectActiveObjects(state).some(object => object.id === id)) {
        s.setState(current => mapActiveSceneObjects(current, objects => [...objects, { id, name: 'Capture camera', kind: 'empty', transform: { position, rotation: [0, 0, 0], scale: [1, 1, 1] } }]));
      }
      const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
      s.setState(current => mapActiveSceneObjects(current, objects => objects.map(object => ({ ...object,
        ...(object.character ? { character: { ...object.character, cameraFollow: false } } : {}),
        ...(object.id === id ? { transform: { position, rotation: [0, Math.atan2(dx, dz), 0], scale: [1, 1, 1] }, character: {
          ...defaultCharacter(), enabled: true, cameraFollow: true, cameraMode: 'firstPerson', mouseLook: false,
          cameraOffset: [0, 0, 0], cameraPitch: Math.atan2(dy, Math.hypot(dx, dz)), cameraMinPitch: -1.55, cameraMaxPitch: 1.55,
          gravity: 0, groundLevel: -1000, autoInputWithScript: false, modelYawOffset: 0,
        } } : {}),
      }))));
    },
  },
});
function Preview() {
  const playing = s(state => state.isPlaying);
  const extensions = useSyncExternalStore(extensionRegistry.subscribe, extensionRegistry.getSnapshot);
  useGameRuntime(playing);
  useRuntimeAudio();
  const panel = extensions.panels.find(panel => panel.pluginId === `feather.${slug === 'arbor-forge' ? 'arbor-forge' : 'model-forge'}`);
  return <div data-store-capture style={{ position: 'fixed', inset: 0, background: '#06121a' }}>{kind === 'plugin' ? <div style={{ height: '100%', padding: '20px', overflow: 'auto' }}>{panel?.render()}</div> : playing && <><GameView /><RuntimeOverlays /></>}</div>;
}
createRoot(document.getElementById('store-capture-root')!).render(<Preview />);
const tick = (now: number) => { if (!frozen && s.getState().isPlaying) { s.getState().tickRuntime(Math.min(0.05, (now - last) / 1000)); void renderCinematicCaptureFrame().catch(() => undefined); } last = now; requestAnimationFrame(tick); };
requestAnimationFrame(tick);
try {
  if (!/^[a-z0-9-]+$/.test(slug) || !['asset', 'project', 'plugin'].includes(kind)) throw new Error('Choose a store package.');
  p.getState().useDemo();
  s.getState().loadProject(blankProject('Store preview'));
  const url = `/__feather/store-package?slug=${encodeURIComponent(slug)}&kind=${kind}`;
  if (kind === 'plugin') startExtensionHost();
  const installed = kind === 'plugin' ? await usePluginStore.getState().installFromUrl(url) : kind === 'project' ? await p.getState().newProjectFromPackageUrl(url, slug) : await p.getState().importPackageFromUrl(url);
  if (!installed) throw new Error(p.getState().error ?? 'Package could not be loaded.');
  if (kind === 'plugin' && slug === 'model-forge') {
    const definition = cinderfallModelDefinitions().find(definition => definition.name.includes('VX-24'))!;
    const id = s.getState().createModelSpec('blank', definition.name);
    if (id) { s.getState().updateModelSpec(id, definition); s.getState().setActiveModelSpec(id); }
  }
  if (kind !== 'plugin') s.getState().setPlaying(true);
  document.body.dataset.storeCapture = 'ready';
} catch (error) { document.body.dataset.storeCaptureError = error instanceof Error ? error.message : String(error); }
