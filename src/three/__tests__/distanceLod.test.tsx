import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Scene, type BufferGeometry } from 'three';
import { ShadowLOD } from '../ShadowLOD';
import { MeshLOD } from '../MeshLOD';

const mocks = vi.hoisted(() => ({
  state: { isPlaying: true, renderSettings: { quality: 'High' } },
  fiber: {} as Record<string, unknown>, frame: () => {},
  getGeometry: vi.fn((geometry: unknown, _level: number) => geometry),
}));
vi.mock('@react-three/fiber', () => ({
  useThree: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.fiber),
  useFrame: (callback: () => void) => { mocks.frame = callback; },
}));
vi.mock('../../store/editorStore', () => ({ useEditorStore: { getState: () => mocks.state } }));
vi.mock('../meshLodCache', () => ({
  getLodGeometry: (geometry: BufferGeometry, level: number) => mocks.getGeometry(geometry, level),
  isLodCandidate: () => true, meshLodReady: () => true,
  preparedLodErrors: () => undefined, setLodGenBudget: () => {},
}));

describe('distance budgets use world-space bounds', () => {
  let root: Root;
  let scene: Scene;
  let camera: PerspectiveCamera;
  const meshes: Mesh[] = [];
  const mesh = (x: number, width = 1, casts = true) => {
    const result = new Mesh(new BoxGeometry(width, 1, 1));
    result.position.x = x; result.castShadow = casts;
    scene.add(result); meshes.push(result);
    return result;
  };
  const frames = () => {
    scene.updateMatrixWorld(true);
    act(() => { for (let i = 0; i < 8; i++) mocks.frame(); });
  };
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    scene = new Scene(); camera = new PerspectiveCamera(); scene.add(camera);
    mocks.state.isPlaying = true; mocks.state.renderSettings.quality = 'High';
    mocks.getGeometry.mockClear();
    mocks.fiber = { scene, camera, gl: { domElement: { height: 600 } } };
    root = createRoot(document.createElement('div'));
  });
  afterEach(() => {
    act(() => root.unmount());
    meshes.splice(0).forEach((object) => object.geometry.dispose());
    delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  });

  it('keeps nearby edges of large buildings casting while culling genuinely distant objects', () => {
    const building = mesh(140, 160);
    const far = mesh(400);
    const nonCaster = mesh(1, 1, false);
    act(() => root.render(<ShadowLOD />)); frames();
    expect(building.castShadow).toBe(true);
    expect(far.castShadow).toBe(false);
    expect(far.visible).toBe(true);
    expect(nonCaster.castShadow).toBe(false);
    mocks.state.isPlaying = false; frames();
    expect(far.castShadow).toBe(true);
    expect(nonCaster.castShadow).toBe(false);
  });

  it('compares shadow casters with a parented camera in world space', () => {
    const rig = new Group(); rig.position.x = 200; scene.add(rig); rig.add(camera);
    const nearby = mesh(250);
    act(() => root.render(<ShadowLOD />)); frames();
    expect(nearby.castShadow).toBe(true);
  });

  it('keeps nearby mesh detail when the camera is attached to a moving rig', () => {
    mocks.state.renderSettings.quality = 'Low';
    const rig = new Group(); rig.position.x = 200; scene.add(rig); rig.add(camera);
    const nearby = mesh(201);
    act(() => root.render(<MeshLOD />)); frames();
    expect(mocks.getGeometry).toHaveBeenCalledWith(nearby.geometry, 0);
    nearby.position.x = 300; frames();
    expect(mocks.getGeometry).toHaveBeenLastCalledWith(nearby.geometry, 2);
  });
});
