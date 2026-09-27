import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { generateMap } from '../towerDefense/game';
import { gardenScenery } from '../towerDefense/scenery';
import { DEFAULT_GARDEN_SEED, gardenController, SPROUTWATCH_MARKER } from '../towerDefense/settings';

/** Build a complete offline game. Scenery is editable; game rules live in towerDefense/game.ts. */
export async function createTowerDefenseTemplate(seed = DEFAULT_GARDEN_SEED): Promise<string> {
  if (!Number.isFinite(seed)) throw new Error('Garden seed must be a finite number.');
  const s = useEditorStore.getState();
  if (s.isPlaying) throw new Error('Stop Play before creating a garden.');
  const existing = gardenController(selectActiveObjects(s));
  if (existing) return existing.id;
  seed = seed >>> 0;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  }
  const sceneId = s.activeSceneId;
  s.renameScene(sceneId, 'Sproutwatch · Garden Outpost');
  s.applyRenderPreset(sceneId, 'vibrant-arcade');
  s.updateSceneEnvironment(sceneId, {
    skyMode: 'color', backgroundColor: '#c9ded5', skyTopColor: '#b7d6d4', skyHorizonColor: '#e6e9d2', skyGroundColor: '#b6cfc0',
    ambientMode: 'hemisphere', ambientIntensity: 1.3, environmentIntensity: 0.9,
    sunColor: '#fff5e4', sunIntensity: 1.65, sunAzimuth: 215, sunElevation: 58, sunShadowExtent: 34,
    fogEnabled: false, fogColor: '#c9ded5', fogNear: 180, fogFar: 300,
    contactShadows: false, toneMapping: 'agx', toneMappingExposure: 1.1,
  });
  s.updateRenderSettings({ quality: 'High', autoQuality: true, bloomEnabled: false, vignetteEnabled: false });
  const controller = s.createObjectWithProps('empty', { name: 'Sproutwatch · Game director', position: [0, 0, 0] });
  s.setObjectVariable(controller, 'gameTemplate', SPROUTWATCH_MARKER);
  s.setObjectVariable(controller, 'seed', seed);
  s.setObjectVariable(controller, 'instructions', 'Play → choose a defender → click a numbered pad → send the wave. 1/2/3 select, Space sends, P pauses. Scenery is editable. Create another project with a different seed for a new layout.');
  const scenery = s.createObjectWithProps('empty', { name: '01 · Editable garden scenery', position: [0, 0, 0], parentId: controller });
  const folder = s.createFolder('Sproutwatch · Garden palette');
  const materials = new Map<string, string>();
  for (const part of gardenScenery(seed)) {
    let materialId = materials.get(part.color);
    if (!materialId) {
      materialId = s.createMaterial(`Garden ${part.color}`, 'Soft matte toy finish. Shared by matching garden props.', folder);
      s.updateMaterial(materialId, { color: part.color, roughness: 0.88, metalness: 0, toon: true, toonFinish: 'rubber', toonBands: 4, toonRimStrength: 0.12, toonRimColor: '#ffefd2' });
      materials.set(part.color, materialId);
    }
    const id = s.createObjectWithProps(part.kind, { name: part.name, position: part.position, parentId: scenery, color: part.color });
    s.updateTransform(id, 'scale', part.scale);
    if (part.rotation) s.updateTransform(id, 'rotation', part.rotation);
    s.setObjectMaterial(id, materialId);
  }
  const pads = s.createObjectWithProps('empty', { name: '02 · Defense pad previews', position: [0, 0, 0], parentId: controller });
  for (const plot of generateMap(seed).plots) {
    const id = s.createObjectWithProps('sphere', { name: `Defense pad ${plot.id}`, position: [plot.x, 0.14, plot.z], parentId: pads, color: '#e5dabc' });
    s.updateTransform(id, 'scale', [1.55, 0.2, 1.55]);
    s.updateRenderer(id, { hideInPlay: true, roughness: 0.9 });
  }
  s.selectObject(controller);
  return controller;
}
