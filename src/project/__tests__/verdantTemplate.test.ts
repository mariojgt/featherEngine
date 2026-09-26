import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createVerdantTemplate } from '../verdantTemplate';
import { blankProject } from '../serialize';
import { buildPackage, remapPackageForImport } from '../package';
import { validateRuntimeReferences } from '../runtimeCompatibility';
import { selectActiveObjects, useEditorStore } from '../../store/editorStore';
import { scanBlueprintGraphProblems } from '../../store/editor/graphDiagnostics';
import { sampleCameraKeyframes } from '../../store/editor/cinematics';
import { sampleTerrainLocalHeight } from '../../terrain/terrain';
import { generateVegetationChunk } from '../../terrain/vegetation';
import { verdantRocks, verdantTreeClearance, VERDANT_SCENERY_ASSETS } from '../verdantScenery';
import { initRapier } from '../../runtime/physicsWorld';

const state = () => useEditorStore.getState();
beforeAll(async () => { await initRapier(); });
beforeEach(() => {
  state().setPlaying(false);
  state().loadProject(blankProject('Verdant test'));
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
    ok: true,
    blob: async () => new Blob(['fixture bytes']),
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
  })));
});
afterEach(() => { state().setPlaying(false); vi.unstubAllGlobals(); });

it('keeps all six camera paths above terrain and every dependency portable after import', async () => {
  const id = await createVerdantTemplate();
  const scene = state().activeScene()!;
  const seq = scene.cinematics!.find(c => c.id === id)!;
  const terrain = selectActiveObjects(state()).find(o => o.terrain)!.terrain!;
  expect(seq).toMatchObject({ duration: 48, frameRate: 24, autoplay: true });
  expect(state().renderSettings).toMatchObject({ quality: 'Epic', autoQuality: false });
  expect(scene.environment).toMatchObject({
    volumetricFogEnabled: true,
    volumetricFogDensity: .0017,
    volumetricFogColor: '#c6cfc5',
    volumetricFogHeight: 1.8,
    volumetricFogFalloff: .22,
    volumetricScattering: .42,
    volumetricSunStrength: 1.35,
  });
  expect(scene.cinematics!.filter(c => c.autoplay)).toHaveLength(1);
  const shots = seq.actions.filter(a => a.type === 'camera');
  expect(shots).toHaveLength(6);
  expect(shots[0].time).toBe(0);
  const trunks = [];
  for (let z=-1; z<=1; z++) for (let x=-1; x<=1; x++) {
    trunks.push(...generateVegetationChunk(terrain,{x,z,id:`${x}:${z}`},{grass:false,flowers:false,groundCover:false}).treeModels);
  }
  const woodClearance=verdantTreeClearance(trunks);
  const rocks=verdantRocks(terrain);
  for (const [i, shot] of shots.entries()) {
    expect(shot.time + shot.duration!).toBe(shots[i + 1]?.time ?? 48);
    for (let t = shot.time; t <= shot.time + shot.duration!; t += 1/24) {
      const pose = sampleCameraKeyframes(shot.keyframes!, t, shot.interpolation)!;
      expect([...pose.position, ...pose.lookAt, pose.fov].every(Number.isFinite)).toBe(true);
      expect(woodClearance(pose.position)).toBeGreaterThan(.9);
      for (const trunk of trunks) {
        expect(Math.hypot(pose.position[0]-trunk.elements[12],pose.position[2]-trunk.elements[14])).toBeGreaterThan(2.2);
      }
      for (const rock of rocks) {
        const horizontal=Math.hypot(pose.position[0]-rock.position[0],pose.position[2]-rock.position[2]);
        expect(pose.position[1]>rock.top+.9 || horizontal>rock.radius+.9).toBe(true);
      }
      expect(pose.position[1] - sampleTerrainLocalHeight(terrain, pose.position[0], pose.position[2])).toBeGreaterThan(.7);
    }
  }
  expect(terrain.foliage).toMatchObject({ distribution: 'woodland', grassMesh: 'natural', treeSource: 'model' });
  expect(terrain.foliage.understoryDensity).toBeGreaterThan(0);
  const text = seq.actions.filter(a => a.type === 'text');
  expect(text.filter(a => a.textStyle === 'lowerThird').map(a => a.text)).toEqual([
    'FOREST FLOOR\nferns, moss and leaf litter',
    'NATURAL TREES\ndetailed bark and wind-driven foliage',
    'LIVING LANDSCAPES\nclustered groves and blade grass',
    'VOLUMETRIC LIGHT\nsunlight through canopy mist',
    'EDITABLE WORLDS\nterrain, foliage and six camera shots',
  ]);
  expect(text.filter(a=>a.textStyle==='lowerThird').map(a=>[a.time,a.duration])).toEqual([[3.45,3.2],[10.25,3.2],[18.75,3.2],[27.75,3.2],[36.75,3.2]]);
  const openingCredit = text.find(a => a.text === 'A FEATHER ENGINE FILM')!;
  const firstFeature = text.find(a => a.text?.startsWith('FOREST FLOOR'))!;
  expect(openingCredit.time + openingCredit.duration!).toBeLessThan(firstFeature.time);
  expect(text.some(a => a.text === 'V E R D A N T' && a.textStyle === 'title')).toBe(true);
  expect(seq.actions.filter(a => a.type === 'sound')).toHaveLength(1);
  expect(state().assets).toHaveLength(16);
  expect(rocks).toHaveLength(36);
  const props=selectActiveObjects(state()).filter(o=>o.renderer?.modelAssetId?.startsWith('verdant-'));
  expect(props.filter(o=>o.renderer?.modelAssetId==='verdant-fern-bank').length).toBeGreaterThan(60);
  expect(props.filter(o=>o.renderer?.modelAssetId==='verdant-shrub').length).toBeGreaterThan(50);
  expect(Object.keys(terrain.paintOverrides).length).toBeGreaterThan(200);
  for (const [assetId] of VERDANT_SCENERY_ASSETS) {
    expect(props.some(o=>o.renderer?.modelAssetId===assetId)).toBe(true);
    expect(state().assets.find(a=>a.id===assetId)?.data).toMatch(/^data:model\/gltf-binary;base64,/);
  }
  const collected = state().buildProjectPackage();
  expect(collected.assetIds).toHaveLength(16);
  for (const blueprint of state().blueprints) {
    expect(scanBlueprintGraphProblems(blueprint, state().graphs.find(g => g.id === blueprint.graphId)!, state().variables)).toEqual([]);
  }
  const pkg = buildPackage('project', collected.content, state().assets, { id: 'verdant-test', name: 'Verdant', version: '1.0.0' });
  const remapped = remapPackageForImport(JSON.parse(JSON.stringify(pkg)), [], []);
  const project = { ...state().exportProject(), ...remapped.content, assets: remapped.assets, activeSceneId: remapped.content.scenes![0].id };
  expect(validateRuntimeReferences(project, project.activeSceneId).errors).toEqual([]);
  const assetIds = new Set(remapped.assets.map(a => a.id));
  for (const sequence of remapped.content.scenes![0].cinematics!) {
    for (const cue of sequence.actions) if (cue.soundId) expect(assetIds.has(cue.soundId)).toBe(true);
  }
});

it('restarts the film and opening fade with R without duplicating scenery', async () => {
  await createVerdantTemplate();
  const count = selectActiveObjects(state()).length;
  state().setPlaying(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  for (let i = 0; i < 6 * 30; i++) state().tickRuntime(1 / 30);
  expect(state().runtimeCinematic!.time).toBeGreaterThan(5);
  state().setRuntimeKey('KeyR', true);
  state().tickRuntime(1 / 30);
  state().setRuntimeKey('KeyR', false);
  state().tickRuntime(1 / 30);
  expect(state().runtimeCinematic!.time).toBeLessThan(.1);
  expect(selectActiveObjects(state())).toHaveLength(count);
});

it('leaves the existing project unchanged when an audio dependency cannot load', async () => {
  const before = state().exportProject();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
  await expect(createVerdantTemplate()).rejects.toThrow();
  expect({ ...state().exportProject(), savedAt: before.savedAt }).toEqual(before);
});


it('pins the portable scenery bytes and camera envelopes to their licensed sources', () => {
  const read=(name:string)=>readFileSync(`src/terrain/models/${name}`);
  const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
  const manifest=JSON.parse(read('verdant-provenance.json').toString());
  expect(manifest.license).toBe('CC0-1.0');
  expect(hash(read('woodland-ground-cover.glb'))).toBe(manifest.sourceSha256);
  expect(hash(read('woodland-trees.glb'))).toBe(manifest.treeSourceSha256);
  expect(JSON.parse(read('verdant-tree-clearance.json').toString()).sourceSha256).toBe(manifest.treeSourceSha256);
  expect(manifest.outputs.map((output:{file:string})=>output.file).sort()).toEqual(VERDANT_SCENERY_ASSETS.map(([id])=>`${id}.glb`).sort());
  for (const output of manifest.outputs) {
    const bytes=read(output.file);
    expect(hash(bytes)).toBe(output.sha256);
    expect(bytes.length).toBe(bytes.readUInt32LE(8));
    const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
    expect(gltf.buffers.every((buffer:{uri?:string})=>!buffer.uri)).toBe(true);
    expect(gltf.images.every((image:{uri?:string;bufferView?:number})=>!image.uri && image.bufferView!==undefined)).toBe(true);
  }
});
