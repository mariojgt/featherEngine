import { defaultPhysics } from '../store/editor/defaults';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { CinematicAction, CinematicTransformKeyframe, MaterialDefinition, SceneObjectKind, Vector3Tuple } from '../types';

export const CRYSTAL_SLICE_DURATION = 12;
export const CRYSTAL_SLICE_COUNT = 8;
const ZERO: Vector3Tuple = [0, 0, 0];
const ONE: Vector3Tuple = [1, 1, 1];
const ease = (value: number) => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

/** Only the machine actuator has an authored path. Detached pieces have no transform tracks. */
export function crystalBladePose(time: number): CinematicTransformKeyframe {
  const firstX = -1.96, pitch = 0.56, stroke = 0.85;
  let x = firstX, y = 4.15;
  if (time >= 1 && time < 1 + CRYSTAL_SLICE_COUNT * stroke) {
    const index = Math.min(CRYSTAL_SLICE_COUNT - 1, Math.floor((time - 1) / stroke));
    const t = (time - 1 - index * stroke) / stroke;
    x += index * pitch;
    if (t < 0.43) y -= 2.88 * ease(t / 0.43);
    else if (t < 0.76) y -= 2.88 * (1 - ease((t - 0.43) / 0.33));
    else if (index < CRYSTAL_SLICE_COUNT - 1) x += pitch * ease((t - 0.76) / 0.24);
  } else if (time >= 7.8) {
    x += 7 * pitch * (1 - ease((time - 10.3) / 1.2));
  }
  return { time, position: [x, y, 0.45], rotation: ZERO, scale: [0.045, 1.6, 2.7] };
}

/** One intact convex stock block, physically held at a rear ledge. A descending blade clips its
 * mesh; full strokes release real colliding bodies. Stock is replenished under the end fade. */
export async function createCrystalSliceTemplate(): Promise<string> {
  const s = useEditorStore.getState(), sceneId = s.activeSceneId;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(o => o.id === id)) s.deleteObject(id);
  }
  s.renameScene(sceneId, 'Crystal Slice · Live Cutting');
  s.applyRenderPreset(sceneId, 'spline-studio');
  s.updateSceneEnvironment(sceneId, {
    skyMode: 'color', backgroundColor: '#060e12', skyLighting: 'studio',
    skyTopColor: '#c5e4e7', skyHorizonColor: '#a8cdd0', skyGroundColor: '#12292f',
    environmentIntensity: 1.25, ambientIntensity: 0.16,
    sunColor: '#ffe5c5', sunIntensity: 1.5, sunElevation: 58, sunAzimuth: 45, sunShadowExtent: 12,
    toneMapping: 'aces', toneMappingExposure: 1.05, dayCycleEnabled: false,
    fogEnabled: false, volumetricFogEnabled: false, atmosphericFog: false,
    contactShadows: true, contactShadowY: 0.64, contactShadowScale: 13,
    contactShadowOpacity: 0.35, contactShadowBlur: 2.4, contactShadowFar: 4,
    contactShadowColor: '#02090b', rainIntensity: 0, wind: ZERO,
  });
  s.updateRenderSettings({ quality: 'Epic', autoQuality: false, bloomEnabled: true,
    bloomIntensity: 0.22, bloomThreshold: 1.1, bloomRadius: 0.5, vignetteEnabled: false,
    colorGrade: { grade: 'none', gradeIntensity: 0 } });
  const folder = s.createFolder('Crystal Slice · Surfaces');
  const surface = (name: string, description: string, props: Partial<MaterialDefinition>) => {
    const id = s.createMaterial(name, description, folder);
    s.updateMaterial(id, { color: '#ffffff', metalness: 0, roughness: 0.12,
      emissiveColor: '#000000', emissiveIntensity: 0, ...props });
    return id;
  };
  const crystal = surface('Turquoise optical gel', 'Thick refractive gel with a polished clear coat. Keep opacity at one for transmission.',
    { color: '#79e6dc', transmission: 0.88, ior: 1.46, thickness: 1.2,
      roughness: 0.095, clearcoat: 0.65, clearcoatRoughness: 0.07 });
  const chrome = surface('Polished chrome', 'Neutral chrome catches the broad studio key and warm strip reflections.',
    { color: '#e2edf0', metalness: 1, roughness: 0.12, clearcoat: 0.35, clearcoatRoughness: 0.09 });
  const graphite = surface('Wet graphite', 'Deep green-black lacquer for a quiet reflective pedestal.',
    { color: '#10262b', metalness: 0.5, roughness: 0.2, clearcoat: 0.8, clearcoatRoughness: 0.1 });
  const gold = surface('Champagne edge', 'A fine warm accent frames the dark stage.',
    { color: '#cba779', metalness: 0.85, roughness: 0.25 });
  const floor = surface('Midnight pool bed', 'Matte submerged floor keeps the water dark beneath the studio reflections.',
    { color: '#030c10', metalness: 0, roughness: 0.95 });

  const part = (kind: SceneObjectKind, name: string, position: Vector3Tuple, scale: Vector3Tuple,
    materialId?: string, parentId?: string, rotation: Vector3Tuple = ZERO) => {
    const id = s.createObjectWithProps(kind, { name, position, parentId });
    s.updateTransform(id, 'scale', scale); s.updateTransform(id, 'rotation', rotation);
    if (materialId) s.setObjectMaterial(id, materialId);
    return id;
  };
  const solid = (id: string, bodyType: 'fixed' | 'kinematic' = 'fixed') => {
    s.togglePhysics(id);
    s.updatePhysics(id, { ...defaultPhysics(bodyType, 'box'), enabled: true,
      friction: 0.34, restitution: 0.14, linearDamping: 0.09, angularDamping: 0.12 });
  };
  // The stock is clamped; released slices overhang the front of the support and tip under gravity.
  const ledge = part('cube', '01 · Rear cutting anvil', [0, 0.35, -0.75], [6.2, 0.6, 1.2], graphite);
  solid(ledge);
  part('cube', 'Anvil · champagne reveal', [0, 0.06, -0.75], [6.26, 0.045, 1.26], gold);
  const bed = part('cube', 'Studio · submerged collision floor', [0, -0.88, 0], [70, 0.3, 70], floor);
  solid(bed);
  const water = part('cube', '02 · Pool / impact-driven ripples', [0, -0.41, 0], [70, 0.66, 70]);
  s.updateRenderer(water, { hideInPlay: true });
  s.updateWater(water, { enabled: true, style: 'custom', shallowColor: '#23454b', deepColor: '#07181d',
    opacity: 0.83, reflectivity: 0.8, waveAmplitude: 0.018, waveFrequency: 1.65,
    waveSpeed: 0.8, loopDuration: CRYSTAL_SLICE_DURATION, flowStrength: 0.12, flowAngle: 90,
    buoyancy: 0.72, drag: 1.5, angularDrag: 0.55, surfaceBounce: 0.04,
    foam: 0.015, sparkle: 0.2, caustics: 0.1, rainStrength: 0, underwaterFog: false });
  const stock = part('cube', '03 · Intact turquoise stock / clamped', [0, 1.775, 0.45], [5.04, 2.15, 2.15], crystal);
  solid(stock);
  s.updatePhysics(stock, { collider: 'convex', mass: 12, materialPreset: 'ice' });
  useEditorStore.setState(state => ({ scenes: state.scenes.map(scene => scene.id === sceneId
    ? { ...scene, objects: scene.objects.map(o => o.id === stock
      ? { ...o, cutting: { enabled: true, role: 'stock' as const, repeatSeconds: CRYSTAL_SLICE_DURATION } } : o) } : scene) }));
  const initialBlade = crystalBladePose(0);
  const blade = part('cube', '04 · Chrome cutting blade', initialBlade.position, initialBlade.scale, chrome);
  solid(blade, 'kinematic');
  s.updatePhysics(blade, { materialPreset: 'metal' });
  useEditorStore.setState(state => ({ scenes: state.scenes.map(scene => scene.id === sceneId
    ? { ...scene, objects: scene.objects.map(o => o.id === blade
      ? { ...o, cutting: { enabled: true, role: 'blade' as const, kerf: 0.049 } } : o) } : scene) }));
  part('cube', 'Cutter · champagne spine', [0, 0.5, 0], [1.7, 0.03, 1.025], gold, blade);
  part('cube', 'Cutter · left guide', [-3.35, 2.5, -1.02], [0.11, 4.9, 0.11], chrome);
  part('cube', 'Cutter · right guide', [3.35, 2.5, -1.02], [0.11, 4.9, 0.11], chrome);
  part('cube', 'Cutter · upper rail', [0, 4.94, -1.02], [6.8, 0.12, 0.12], graphite);

  const lamp = (name: string, position: Vector3Tuple, target: Vector3Tuple, color: string, intensity: number, width: number, height: number) => {
    const id = part('light', name, position, ONE);
    // XYZ Euler of a -Z facing lamp, without roll.
    const dx = target[0] - position[0], dy = target[1] - position[1], dz = target[2] - position[2];
    s.updateTransform(id, 'rotation', [Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0]);
    s.setObjectLight(id, { type: 'rect', color, intensity, width, height, castShadow: false });
  };
  lamp('Studio · broad pearl key', [-3, 6, 4], [0, 1, 0], '#edfaff', 4, 6, 4);
  lamp('Studio · warm rear strip', [1, 4, -4], [0, 1.5, 0], '#ffd19d', 6, 7, 0.9);
  lamp('Studio · cool side fill', [6, 3, 0], [0, 1.5, 0], '#9ee9eb', 2.5, 3, 4);

  const cinematicId = s.createCinematic('Crystal Slice · Cut / Fall / Splash', CRYSTAL_SLICE_DURATION);
  s.updateCinematic(cinematicId, { autoplay: true, skippable: false, loop: true, frameRate: 60 });
  s.setCinematicLook(cinematicId, { letterbox: 0, grade: 'none', grain: 0, vignette: 0.12, motionBlur: 0 });
  const beat = (action: Omit<CinematicAction, 'id'>) => s.addCinematicAction(cinematicId, action);
  const times = Array.from({ length: CRYSTAL_SLICE_DURATION * 30 + 1 }, (_, i) => i / 30);
  beat({ type: 'transform', label: 'Blade actuator · eight full strokes', time: 0,
    duration: CRYSTAL_SLICE_DURATION, objectId: blade, interpolation: 'linear',
    transformKeyframes: times.map(crystalBladePose) });
  beat({ type: 'camera', label: 'Cutting station · macro', time: 0, duration: CRYSTAL_SLICE_DURATION,
    interpolation: 'linear', keyframes: [0, CRYSTAL_SLICE_DURATION].map(time => ({
      time, position: [7.9, 5.7, 10.4] as Vector3Tuple,
      lookAt: [0, 1.7, 0.6] as Vector3Tuple, fov: 36, aperture: 0 })) });
  beat({ type: 'fade', label: 'Reveal intact stock', time: 0, duration: 0.55,
    fadeFrom: 1, fadeTo: 0, fadeColor: '#060e12' });
  beat({ type: 'fade', label: 'Replenish stock under darkness', time: 11.4, duration: 0.6,
    fadeFrom: 0, fadeTo: 1, fadeColor: '#060e12' });
  for (const [time, name] of [[0, 'One intact block'], [1, 'Cutting / physical release'],
    [7.8, 'Pieces settle in the pool'], [11.4, 'Stock replenishment'], [12, 'New cycle']] as const) {
    s.addCinematicMarker(cinematicId, { time, label: name });
  }
  s.selectObject('');
  return cinematicId;
}
