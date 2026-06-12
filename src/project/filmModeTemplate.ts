import { getPlatform } from '../platform';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { inspectModel } from '../three/inspectModel';
import type { AssetItem, CinematicTransformKeyframe, Vector3Tuple } from '../types';

/**
 * THE SUMMIT — a 32s self-running cinematic on a storm-swept mountain peak above a sea of
 * clouds at cold dawn. A lone hero (the bundled UAL rigged character: idle → walk → idle,
 * swapped by visibility beats) climbs a banner-lined ridge to a dark monolith on the summit.
 * Every banner — and the hero's cape — is a REAL cloth sheet driven by one global scene wind,
 * which is the demo's thesis: one wind value moves the whole world. As the hero arrives, cyan
 * runes wake up the monolith face (material tracks) while dawn god-rays rake the summit
 * (volumetric fog + shafts); the charge overloads and at t=24 the monolith SHATTERS on the
 * music hit (white-cyan flash + debris shards + shockwave + violent shake) — and the falling
 * debris converges upward into the FEATHER ENGINE neon wordmark floating over the clouds.
 *
 * Engine features on display:
 *   - Cloth + global wind: three ridge flags (left-edge pin), two summit banners (top-edge
 *     pin) and a cape pinned to the walking hero, all blowing from the single scene `wind`
 *     vector + turbulence. The opening shot is a macro rack-focus on rippling cloth.
 *   - Volumetric light: raymarched height fog forms the cloud sea below the peak; the low
 *     dawn sun drives in-scattering god rays across the monolith (High preset shafts).
 *   - Material tracks: runes ignite bottom-up as the hero arrives, the core seam pulses
 *     through the overload, and the wordmark does a per-stroke neon flicker ignition.
 *   - The shatter→reveal: at the music hit the monolith swaps to keyframed debris shards
 *     while 51 wordmark strokes fly in from scattered offsets and snap into the logo —
 *     every stroke is one small transform track, all spline-evaluated live.
 *
 * Audio (imported from `public/templates/fall/` + `public/templates/monolith/`):
 *   - fall_music.wav       — 32s orchestral bed (its big hit lands at ~24s = the shatter)
 *   - wind_rush.mp3        — the gust as the ascent begins
 *   - portal_approach.mp3  — the overload swell
 *   - lightning_crack.mp3 + awakening_impact.mp3 — the shatter
 *   - arrival_chime.mp3    — the wordmark ignition
 *
 * The whole scene is plain primitives + cloth + particles + cinematic beats — open the
 * project after Play stops and everything is editable.
 */

const DURATION = 32;
const FALL_AUDIO_DIR = 'templates/fall';
const MONOLITH_AUDIO_DIR = 'templates/monolith';

// Layout: the summit plateau tops out at y=40 (world origin region). The hero walks the ridge
// down +X (from x≈13.5) to the monolith at x≈-3.5. The cloud sea sits at y≈18–28, distant
// peaks poke through it. The wordmark reveal floats at y≈51, faced toward +X for the crane.
const PLATEAU_TOP_Y = 40;
const SHATTER_TIME = 24;
const MONOLITH_POS: Vector3Tuple = [-3.5, 43.6, 0];
const LOGO_POS: Vector3Tuple = [-1, 47, 0];

async function importTemplateAudio(dir: string, file: string, mimeType: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'audio');
  if (existing) return existing;
  try {
    const response = await fetch(`${dir}/${file}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const platformFile = new File([blob], file, { type: mimeType });
    const platform = await getPlatform();
    const projectDir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(projectDir, platformFile);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name: file, type: 'audio', size: platformFile.size, path, url, folderId, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return useEditorStore.getState().assets.find((a) => a.id === assetId);
  } catch {
    return undefined;
  }
}

// ============================================================================
// PIXEL FONT — 5×7 stroke-based letters for the FEATHER ENGINE wordmark.
// ============================================================================
type Stroke = readonly [x: number, y: number, w: number, h: number];

const LETTER_STROKES: Record<string, readonly Stroke[]> = {
  F: [[0,0,1,7], [0,6,5,1], [0,3,4,1]],
  E: [[0,0,1,7], [0,6,5,1], [0,3,4,1], [0,0,5,1]],
  A: [[0,0,1,7], [4,0,1,7], [0,6,5,1], [0,3,5,1]],
  T: [[0,6,5,1], [2,0,1,7]],
  H: [[0,0,1,7], [4,0,1,7], [1,3,3,1]],
  R: [[0,0,1,7], [0,6,4,1], [4,4,1,2], [0,3,4,1], [2,2,1,1], [3,1,1,1], [4,0,1,1]],
  N: [[0,0,1,7], [4,0,1,7], [1,5,1,1], [2,4,1,1], [3,3,1,1]],
  G: [[1,6,4,1], [1,0,4,1], [0,1,1,5], [4,0,1,4], [3,3,2,1]],
  I: [[0,6,5,1], [2,0,1,7], [0,0,5,1]],
};

/** One wordmark stroke cube + the local pose the convergence track must land on. */
interface WordmarkStroke {
  id: string;
  position: Vector3Tuple;
  scale: Vector3Tuple;
}

function placeLetter(parentId: string, char: string, anchor: Vector3Tuple, cellSize: number, depth: number, emissive: string, intensity: number, letterIndex: number): WordmarkStroke[] {
  const store = useEditorStore.getState();
  const strokes = LETTER_STROKES[char];
  if (!strokes) return [];
  const placed: WordmarkStroke[] = [];
  strokes.forEach((stroke, strokeIndex) => {
    const [sx, sy, sw, sh] = stroke;
    const position: Vector3Tuple = [
      anchor[0] + (sx + sw / 2) * cellSize,
      anchor[1] + (sy + sh / 2) * cellSize,
      anchor[2],
    ];
    const scale: Vector3Tuple = [sw * cellSize, sh * cellSize, depth];
    const id = store.createObjectWithProps('cube', {
      name: `Logo · ${char}${letterIndex}-${strokeIndex}`,
      position,
      color: '#02080c',
      parentId,
    });
    store.updateTransform(id, 'scale', scale);
    store.updateRenderer(id, {
      metalness: 0.4,
      roughness: 0.25,
      materialOverrides: { emissiveColor: emissive, emissiveIntensity: intensity },
    });
    placed.push({ id, position, scale });
  });
  return placed;
}

function placeLine(parentId: string, text: string, baselineY: number, z: number, cellSize: number, depth: number, emissive: string, intensity: number): WordmarkStroke[] {
  const letterWidth = 5 * cellSize;
  const gap = 1.2 * cellSize;
  const totalWidth = text.length * letterWidth + (text.length - 1) * gap;
  const startX = -totalWidth / 2;
  const placed: WordmarkStroke[] = [];
  text.split('').forEach((char, index) => {
    if (char === ' ') return;
    const anchor: Vector3Tuple = [startX + index * (letterWidth + gap), baselineY, z];
    placed.push(...placeLetter(parentId, char, anchor, cellSize, depth, emissive, intensity, index));
  });
  return placed;
}

/** Deterministic jitter in [-1, 1] so the mountain reads as natural rock without RNG. */
const jitter = (seed: number) => Math.sin(seed * 12.9898 + 4.1414) % 1;

/**
 * Fetch + import + rig-split the bundled UAL character (the same Quaternius rig the third-person
 * template uses), reusing it if already imported. Returns the model asset id, or undefined when
 * the bundle is missing (the hero then falls back to a primitive figure).
 */
async function importHeroCharacter(): Promise<string | undefined> {
  const state = useEditorStore.getState();
  const existing = state.assets.find((a) => a.name === 'UAL1.glb' && a.type === 'model');
  if (existing && state.skeletalMeshes.some((m) => m.sourceAssetId === existing.id)) return existing.id;
  try {
    const response = await fetch('templates/UAL1.glb');
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const file = new File([blob], 'UAL1.glb', { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = existing?.id ?? `asset-${crypto.randomUUID()}`;
    if (!existing) {
      const item: AssetItem = { id: assetId, name: 'UAL1.glb', type: 'model', size: file.size, path, url, createdAt: Date.now() };
      useEditorStore.getState().addAssetItems([item]);
    }
    const inspection = await inspectModel(file);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: 'UAL1.glb', inspection });
    return assetId;
  } catch {
    return undefined;
  }
}

/** Ridge ground height under the hero's path (slabs are authored to match this slope). */
const ridgeGroundY = (x: number) => (x > 5.5 ? PLATEAU_TOP_Y - 1.6 + (13.5 - Math.min(x, 13.5)) * 0.19 : PLATEAU_TOP_Y);

export async function createFilmModeTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;

  // ============================================================================
  // AUDIO IMPORT — the fall-kit orchestral bed (its hit lands on the shatter)
  // plus the monolith kit's crack/impact/swell/chime.
  // ============================================================================
  const audioFolder = store.createFolder('The Summit Audio');
  const musicAsset =
    (await importTemplateAudio(FALL_AUDIO_DIR, 'fall_music.wav', 'audio/wav', audioFolder)) ??
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'awakening_music.wav', 'audio/wav', audioFolder));
  const windAsset =
    (await importTemplateAudio(FALL_AUDIO_DIR, 'wind_rush.mp3', 'audio/mpeg', audioFolder)) ??
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'door_whoosh.mp3', 'audio/mpeg', audioFolder));
  const crackAsset = await importTemplateAudio(MONOLITH_AUDIO_DIR, 'lightning_crack.mp3', 'audio/mpeg', audioFolder);
  const boomAsset =
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'awakening_impact.mp3', 'audio/mpeg', audioFolder)) ??
    (await importTemplateAudio(FALL_AUDIO_DIR, 'water_impact.mp3', 'audio/mpeg', audioFolder));
  const swellAsset = await importTemplateAudio(MONOLITH_AUDIO_DIR, 'portal_approach.mp3', 'audio/mpeg', audioFolder);
  const chimeAsset = await importTemplateAudio(MONOLITH_AUDIO_DIR, 'arrival_chime.mp3', 'audio/mpeg', audioFolder);

  // ============================================================================
  // THE MOUNTAIN — summit plateau, ascending ridge, and the mass falling away
  // into the cloud sea below.
  // ============================================================================
  const rockColors = ['#1b1f2c', '#222636', '#171a26'];
  const plateauId = store.createObjectWithProps('cube', { name: 'Summit Plateau', position: [-1, PLATEAU_TOP_Y - 1, 0], color: '#1f2330' });
  store.updateTransform(plateauId, 'scale', [13, 2, 12]);
  store.updateRenderer(plateauId, { metalness: 0.08, roughness: 0.9 });

  // The ridge the hero ascends — two long slabs whose tops match `ridgeGroundY`.
  ([
    { position: [12.8, 36.5, 0] as Vector3Tuple, scale: [7.5, 3.8, 5.5] as Vector3Tuple },
    { position: [8.3, 37.15, 0.2] as Vector3Tuple, scale: [6.5, 4.1, 5.8] as Vector3Tuple },
    { position: [5.3, 39.55, 0] as Vector3Tuple, scale: [1.8, 0.9, 4.8] as Vector3Tuple }, // step onto the plateau
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Ridge Slab ${index + 1}`, position: spec.position, color: rockColors[index % 3] });
    store.updateTransform(id, 'scale', spec.scale);
    store.updateTransform(id, 'rotation', [0, jitter(index + 31) * 0.04, 0]);
    store.updateRenderer(id, { metalness: 0.08, roughness: 0.9 });
  });

  // The mountain mass below the plateau, widening as it drops into the clouds.
  for (let i = 0; i < 6; i += 1) {
    const id = store.createObjectWithProps('cube', {
      name: `Mountain Mass ${i + 1}`,
      position: [-1 + jitter(i + 3) * 1.4, 36 - i * 5.5, jitter(i + 9) * 1.6],
      color: rockColors[i % 3],
    });
    store.updateTransform(id, 'scale', [14 + i * 3.2, 6.2, 12 + i * 3.4]);
    store.updateTransform(id, 'rotation', [0, jitter(i + 17) * 0.08, 0]);
    store.updateRenderer(id, { metalness: 0.06, roughness: 0.92 });
  }

  // Distant peaks poking through the cloud sea — silhouettes for parallax.
  ([
    { position: [-42, 26, -55] as Vector3Tuple, scale: [18, 32, 16] as Vector3Tuple, yaw: 0.7 },
    { position: [-66, 21, 22] as Vector3Tuple, scale: [22, 26, 18] as Vector3Tuple, yaw: -0.4 },
    { position: [36, 19, -70] as Vector3Tuple, scale: [20, 24, 17] as Vector3Tuple, yaw: 1.2 },
    { position: [56, 23, 46] as Vector3Tuple, scale: [24, 30, 20] as Vector3Tuple, yaw: -0.9 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Distant Peak ${index + 1}`, position: spec.position, color: '#11182a' });
    store.updateTransform(id, 'scale', spec.scale);
    store.updateTransform(id, 'rotation', [0.05, spec.yaw, jitter(index + 51) * 0.08]);
    store.updateRenderer(id, { metalness: 0, roughness: 1 });
  });

  // Cracked paving + rubble so the summit reads as a built, abandoned place.
  ([
    { position: [0.6, PLATEAU_TOP_Y + 0.03, 1.4] as Vector3Tuple, scale: [2.6, 0.1, 2.2] as Vector3Tuple, yaw: 0.12 },
    { position: [-1.8, PLATEAU_TOP_Y + 0.03, -1.6] as Vector3Tuple, scale: [2.2, 0.1, 2.6] as Vector3Tuple, yaw: -0.2 },
    { position: [-2.6, PLATEAU_TOP_Y + 0.03, 1.9] as Vector3Tuple, scale: [1.8, 0.1, 1.8] as Vector3Tuple, yaw: 0.34 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Summit Paving ${index + 1}`, position: spec.position, color: '#262b3c' });
    store.updateTransform(id, 'scale', spec.scale);
    store.updateTransform(id, 'rotation', [0, spec.yaw, 0]);
    store.updateRenderer(id, { metalness: 0.1, roughness: 0.8 });
  });
  for (let i = 0; i < 3; i += 1) {
    const id = store.createObjectWithProps('cube', {
      name: `Summit Rubble ${i + 1}`,
      position: [-3.5 + jitter(i + 71) * 2.4, PLATEAU_TOP_Y + 0.18, 1.2 + jitter(i + 77) * 2.2],
      color: '#1b1f2c',
    });
    store.updateTransform(id, 'scale', [0.5 + jitter(i + 81) * 0.2, 0.35, 0.45 + jitter(i + 83) * 0.2]);
    store.updateTransform(id, 'rotation', [jitter(i + 87) * 0.4, jitter(i + 89) * 1.2, jitter(i + 91) * 0.3]);
    store.updateRenderer(id, { metalness: 0.08, roughness: 0.9 });
  }

  // ============================================================================
  // BANNERS & FLAGS — real cloth sheets, all driven by the ONE global scene wind.
  // Ridge flags pin their pole edge ('left-edge'); summit banners hang from
  // crossbars ('top-edge'). Per-cloth wind stays [0,0,0] so the global vector is
  // the only thing moving them — change it live and the whole world answers.
  // ============================================================================
  const makeRidgeFlag = (x: number, z: number, index: number) => {
    const groundY = ridgeGroundY(x);
    const poleId = store.createObjectWithProps('cube', { name: `Flag Pole ${index + 1}`, position: [x, groundY + 1.5, z], color: '#3a3f52' });
    store.updateTransform(poleId, 'scale', [0.09, 3.0, 0.09]);
    store.updateRenderer(poleId, { metalness: 0.5, roughness: 0.5 });
    const flagId = store.createObjectWithProps('plane', { name: `Ridge Flag ${index + 1}`, position: [x, groundY + 2.4, z + 0.85], color: '#8c2230' });
    // Yaw -90° maps the sheet's pinned left edge onto the pole and lets the free
    // end stream along +Z with the prevailing wind.
    store.updateTransform(flagId, 'rotation', [0, -Math.PI / 2, 0]);
    store.updateRenderer(flagId, { metalness: 0.05, roughness: 0.9 });
    store.addCloth(flagId);
    store.updateCloth(flagId, { enabled: true, sourceMode: 'grid', resolution: 12, width: 1.7, height: 0.95, pinMode: 'left-edge', wind: [0, 0, 0], turbulence: 0.3, collideFloor: false });
  };
  makeRidgeFlag(12.5, -2.0, 0);
  makeRidgeFlag(9.2, 2.0, 1);
  makeRidgeFlag(6.2, -2.1, 2);

  // Two tall hanging banners flanking the monolith.
  [-2.7, 2.7].forEach((bz, index) => {
    [-0.75, 0.75].forEach((dz, postIndex) => {
      const postId = store.createObjectWithProps('cube', { name: `Banner Post ${index + 1}-${postIndex + 1}`, position: [-3.3, PLATEAU_TOP_Y + 1.6, bz + dz], color: '#3a3f52' });
      store.updateTransform(postId, 'scale', [0.09, 3.2, 0.09]);
      store.updateRenderer(postId, { metalness: 0.5, roughness: 0.5 });
    });
    const barId = store.createObjectWithProps('cube', { name: `Banner Bar ${index + 1}`, position: [-3.3, PLATEAU_TOP_Y + 3.15, bz], color: '#3a3f52' });
    store.updateTransform(barId, 'scale', [0.08, 0.08, 1.7]);
    store.updateRenderer(barId, { metalness: 0.5, roughness: 0.5 });
    const bannerId = store.createObjectWithProps('plane', { name: `Summit Banner ${index + 1}`, position: [-3.3, PLATEAU_TOP_Y + 2.05, bz], color: '#7a1d2c' });
    store.updateTransform(bannerId, 'rotation', [0, -Math.PI / 2, 0]); // top edge spans the crossbar (Z)
    store.updateRenderer(bannerId, { metalness: 0.05, roughness: 0.9 });
    store.addCloth(bannerId);
    store.updateCloth(bannerId, { enabled: true, sourceMode: 'grid', resolution: 12, width: 1.2, height: 2.1, pinMode: 'top-edge', wind: [0, 0, 0], turbulence: 0.25, collideFloor: false });
  });

  // ============================================================================
  // THE HERO — UAL rig under one empty (a single transform track walks him up the
  // ridge), idle/walk model children swapped by visibility beats, and a cloth
  // cape pinned to his shoulders so the wind story rides on him too.
  // ============================================================================
  const heroStartX = 13.5;
  const heroId = store.createObjectWithProps('empty', { name: 'Hero', position: [heroStartX, ridgeGroundY(heroStartX) + 0.9, 0.15] });
  const heroAssetId = await importHeroCharacter();
  const heroState = useEditorStore.getState();
  const heroMesh = heroAssetId ? heroState.skeletalMeshes.find((m) => m.sourceAssetId === heroAssetId) : undefined;
  const heroClips = heroMesh ? heroState.animations.filter((a) => a.skeletonId === heroMesh.skeletonId) : [];
  const pickClip = (...patterns: RegExp[]) => {
    for (const pattern of patterns) {
      const found = heroClips.find((clip) => pattern.test(clip.name));
      if (found) return found.id;
    }
    return undefined;
  };
  const idleClipId = pickClip(/idle_loop/i, /^idle/i, /idle/i);
  const walkClipId = pickClip(/walk_loop/i, /^walk/i, /walk/i);

  let heroIdleId: string | undefined;
  let heroWalkId: string | undefined;
  if (heroAssetId && heroMesh && (idleClipId || walkClipId)) {
    const makeHeroModel = (name: string, clipId: string | undefined) => {
      // Local offset puts the rig's feet 0.9 below the empty (the empty rides at the pelvis).
      const id = store.createObjectWithProps('cube', { name, position: [0, -0.9, 0], parentId: heroId });
      store.updateTransform(id, 'rotation', [0, -Math.PI / 2, 0]); // rig forward +Z → face -X (toward the monolith)
      store.setObjectModel(id, heroAssetId);
      store.toggleAnimator(id);
      store.updateAnimator(id, { skeletalMeshId: heroMesh.id, animationId: clipId, loop: true, speed: 1 });
      return id;
    };
    heroIdleId = makeHeroModel('Hero · Idle', idleClipId ?? walkClipId);
    heroWalkId = makeHeroModel('Hero · Walk', walkClipId ?? idleClipId);
  } else {
    // Fallback primitive figure (bundle missing / web fetch failed).
    const bodyId = store.createObjectWithProps('capsule', { name: 'Hero · Body', position: [0, 0, 0], color: '#161018', parentId: heroId });
    store.updateTransform(bodyId, 'scale', [0.45, 0.55, 0.45]);
    store.updateRenderer(bodyId, { metalness: 0.2, roughness: 0.6 });
    const headId = store.createObjectWithProps('sphere', { name: 'Hero · Head', position: [0, 0.66, 0], color: '#1a1216', parentId: heroId });
    store.updateTransform(headId, 'scale', [0.26, 0.26, 0.26]);
    store.updateRenderer(headId, { metalness: 0.2, roughness: 0.55 });
  }
  // The cape: a small top-edge-pinned cloth riding the hero's shoulders. He walks
  // toward -X, so it trails behind at +X and streams with the global wind.
  const capeId = store.createObjectWithProps('plane', { name: 'Hero · Cape', position: [0.24, 0.5, 0], color: '#5e1622', parentId: heroId });
  store.updateTransform(capeId, 'rotation', [0, -Math.PI / 2, 0]);
  store.updateRenderer(capeId, { metalness: 0.05, roughness: 0.85 });
  store.addCloth(capeId);
  store.updateCloth(capeId, { enabled: true, sourceMode: 'grid', resolution: 8, width: 0.55, height: 0.9, pinMode: 'top-edge', wind: [0, 0, 0], turbulence: 0.2, collideFloor: false });

  // ============================================================================
  // THE MONOLITH — a dark slab on the summit whose carved runes wake as the hero
  // arrives, then overload and shatter into the wordmark.
  // ============================================================================
  const monolithId = store.createObjectWithProps('cube', { name: 'Monolith', position: MONOLITH_POS, color: '#0e0d14' });
  store.updateTransform(monolithId, 'scale', [1.5, 7.2, 1.0]);
  store.updateRenderer(monolithId, { metalness: 0.35, roughness: 0.45 });

  // Runes carved on the +X face (toward the approaching hero): five side glyphs
  // igniting bottom-up, then the full-height core seam.
  const runeFaceX = MONOLITH_POS[0] + 0.78;
  const runeEntries: Array<{ id: string; at: number; peak: number }> = [];
  ([
    { y: 41.2, z: 0.28, at: 14.0 },
    { y: 42.4, z: -0.28, at: 14.8 },
    { y: 43.8, z: 0.28, at: 15.6 },
    { y: 45.0, z: -0.28, at: 16.4 },
    { y: 46.0, z: 0.28, at: 17.0 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Monolith Rune ${index + 1}`, position: [runeFaceX, spec.y, spec.z], color: '#0a1018' });
    store.updateTransform(id, 'scale', [0.06, 0.34, 0.5]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: '#8fd8ff', emissiveIntensity: 0 } });
    runeEntries.push({ id, at: spec.at, peak: 7 });
  });
  const seamId = store.createObjectWithProps('cube', { name: 'Monolith Core Seam', position: [runeFaceX, MONOLITH_POS[1], 0], color: '#0a1018' });
  store.updateTransform(seamId, 'scale', [0.06, 5.8, 0.12]);
  store.updateRenderer(seamId, { materialOverrides: { emissiveColor: '#8fd8ff', emissiveIntensity: 0 } });

  // Cold rune light + the charge swirl, both hidden until the runes wake.
  const monolithLightId = store.createObjectWithProps('light', { name: 'Monolith Light', position: [-2.4, 45, 1.4] });
  store.setObjectLight(monolithLightId, { type: 'point', color: '#8fd8ff', intensity: 13, distance: 24, angle: 0, castShadow: false });
  const swirlId = store.createObjectWithProps('empty', { name: 'Charge Swirl', position: [MONOLITH_POS[0], 43.5, 0] });
  store.addParticles(swirlId, 'magic');
  store.updateParticles(swirlId, { rate: 42, lifetime: 1.8, shapeRadius: 1.3, startColor: '#8fd8ff', endColor: '#2a4eda', startSize: 0.1, endSize: 0.02, startOpacity: 0.85 });

  // Shatter kit — debris shards (keyframed outward), burst emitters, shockwave
  // ring and a hard cyan flash light. Everything hidden until the exact frame.
  const shardEntries: Array<{ id: string; from: Vector3Tuple; to: Vector3Tuple; spin: Vector3Tuple }> = [];
  for (let i = 0; i < 9; i += 1) {
    const from: Vector3Tuple = [
      MONOLITH_POS[0] + jitter(i * 3 + 1) * 0.5,
      MONOLITH_POS[1] + jitter(i * 5 + 2) * 2.6,
      jitter(i * 7 + 3) * 0.3,
    ];
    const angle = (i / 9) * Math.PI * 2;
    const to: Vector3Tuple = [
      MONOLITH_POS[0] + Math.cos(angle) * (5.5 + jitter(i + 41) * 1.5),
      MONOLITH_POS[1] + 3.2 + jitter(i + 43) * 2.2,
      Math.sin(angle) * (5.5 + jitter(i + 47) * 1.5),
    ];
    const id = store.createObjectWithProps('cube', { name: `Monolith Shard ${i + 1}`, position: from, color: '#12131c' });
    store.updateTransform(id, 'scale', [0.45 + jitter(i + 53) * 0.25, 0.6 + jitter(i + 57) * 0.3, 0.35 + jitter(i + 59) * 0.2]);
    store.updateRenderer(id, { metalness: 0.35, roughness: 0.45, materialOverrides: { emissiveColor: '#8fd8ff', emissiveIntensity: 1.2 } });
    shardEntries.push({ id, from, to, spin: [jitter(i + 61) * 3, jitter(i + 63) * 4, jitter(i + 67) * 2.5] });
  }
  const burstId = store.createObjectWithProps('empty', { name: 'Shatter Burst', position: [MONOLITH_POS[0], 43.6, 0] });
  store.addParticles(burstId, 'explosion');
  store.updateParticles(burstId, { startColor: '#dffaff', endColor: '#3a6cff', startSize: 0.22, endSize: 0.04 });
  const sparksId = store.createObjectWithProps('empty', { name: 'Shatter Sparks', position: [MONOLITH_POS[0], 43.6, 0] });
  store.addParticles(sparksId, 'sparks');
  store.updateParticles(sparksId, { rate: 260, lifetime: 1.4, speed: 8, shapeRadius: 0.7, startColor: '#eafcff', endColor: '#5b8cff', startSize: 0.14, endSize: 0.02 });
  const shockwaveId = store.createObjectWithProps('sphere', { name: 'Shockwave Ring', position: [MONOLITH_POS[0], PLATEAU_TOP_Y + 0.15, 0], color: '#dffaff' });
  store.updateTransform(shockwaveId, 'scale', [0.1, 0.05, 0.1]);
  store.updateRenderer(shockwaveId, { opacity: 0.55, materialOverrides: { emissiveColor: '#dffaff', emissiveIntensity: 0 } });
  const impactLightId = store.createObjectWithProps('light', { name: 'Shatter Light', position: [-2.6, 45.5, 1] });
  store.setObjectLight(impactLightId, { type: 'point', color: '#bfe8ff', intensity: 18, distance: 26, angle: 0, castShadow: false });

  // ============================================================================
  // ATMOSPHERE — the cloud sea below the peak and wind-blown spindrift streaking
  // across the ridge (particles sell what the volumetric fog implies).
  // ============================================================================
  ([
    { position: [-10, 27, -8] as Vector3Tuple, radius: 38 },
    { position: [14, 26, 12] as Vector3Tuple, radius: 36 },
    { position: [0, 18, 0] as Vector3Tuple, radius: 52 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('empty', { name: `Cloud Sea ${index + 1}`, position: spec.position });
    store.addParticles(id, 'dust');
    store.updateParticles(id, { rate: 14, lifetime: 5, speed: 0.5, shapeRadius: spec.radius, startColor: '#e8eef8', endColor: '#8fa3c0', startSize: 4.5, endSize: 9, startOpacity: 0.12 });
  });
  ([
    { position: [9, 40.6, 0] as Vector3Tuple },
    { position: [-1.5, 41.6, 0] as Vector3Tuple },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('empty', { name: `Spindrift ${index + 1}`, position: spec.position });
    store.addParticles(id, 'dust');
    store.updateParticles(id, { rate: 24, lifetime: 2.0, speed: 5, direction: [0.4, 0.12, 1], shapeRadius: 5.5, startColor: '#dfe9f6', endColor: '#9fb4cc', startSize: 0.12, endSize: 0.4, startOpacity: 0.2 });
  });

  // ============================================================================
  // BIRDS — two silhouettes riding the wind around the peak during the ascent.
  // ============================================================================
  const birdIds: Array<{ id: string; cx: number; cy: number; cz: number; radius: number; phase: number }> = [];
  for (let i = 0; i < 2; i += 1) {
    const id = store.createObjectWithProps('cube', { name: `Bird ${i + 1}`, position: [4, 46 + i * 2.5, 6], color: '#0d0a0c' });
    store.updateTransform(id, 'scale', [0.6, 0.06, 0.18]);
    store.updateRenderer(id, { metalness: 0, roughness: 1 });
    birdIds.push({ id, cx: 0, cy: 46 + i * 2.5, cz: 0, radius: 13 + i * 4, phase: i * 2.4 });
  }

  // ============================================================================
  // WORDMARK — FEATHER ENGINE in unlit neon floating over the clouds, faced
  // toward +X so the reveal crane reads it left-to-right. Hidden until the
  // shatter, when its strokes fly in from scattered offsets and snap into place.
  // ============================================================================
  const logoEmptyId = store.createObjectWithProps('empty', { name: 'Feather Engine Logo', position: LOGO_POS });
  store.updateTransform(logoEmptyId, 'rotation', [0, Math.PI / 2, 0]);
  const CELL = 0.2;
  const LETTER_DEPTH = 0.18;
  const wordmarkStrokes = [
    ...placeLine(logoEmptyId, 'FEATHER', 5.4, 0, CELL, LETTER_DEPTH, '#aeeaff', 0),
    ...placeLine(logoEmptyId, 'ENGINE', 3.6, 0, CELL, LETTER_DEPTH, '#aeeaff', 0),
  ];
  const haloIds = [5.4, 3.6].map((baseline, index) => {
    const id = store.createObjectWithProps('cube', {
      name: index === 0 ? 'Halo · FEATHER' : 'Halo · ENGINE',
      position: [0, baseline + (CELL * 7) / 2, -0.22],
      color: '#0a1424',
      parentId: logoEmptyId,
    });
    store.updateTransform(id, 'scale', [index === 0 ? 10.0 : 8.6, 1.9, 0.08]);
    store.updateRenderer(id, { opacity: 0.22, materialOverrides: { emissiveColor: '#aeeaff', emissiveIntensity: 0 } });
    return id;
  });
  const logoLightId = store.createObjectWithProps('light', { name: 'Wordmark Light', position: [LOGO_POS[0] + 4.5, 52, 0] });
  store.setObjectLight(logoLightId, { type: 'point', color: '#aeeaff', intensity: 9, distance: 22, angle: 0, castShadow: false });

  // ============================================================================
  // ENVIRONMENT — cold mountain dawn: pale gold horizon under a steel-blue sky,
  // ONE global wind driving every cloth sheet, and volumetric height fog forming
  // the cloud sea + god rays off the low sun.
  // ============================================================================
  store.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural',
    skyTopColor: '#0e1631',
    skyHorizonColor: '#ffb46e',
    skyGroundColor: '#232036',
    environmentIntensity: 0.65,
    sunColor: '#ffd9a0',
    sunIntensity: 1.5,
    sunElevation: 7,
    sunAzimuth: 255,
    fogEnabled: true,
    fogColor: '#2b3650',
    fogNear: 50,
    fogFar: 260,
    volumetricFogEnabled: true,
    volumetricFogDensity: 0.055,
    volumetricFogColor: '#c8d8ee',
    volumetricFogHeight: 34,
    volumetricFogFalloff: 0.12,
    volumetricScattering: 0.65,
    volumetricSunStrength: 1.7,
    volumetricMaxDistance: 170,
    wind: [2.2, 0, 5.2],
    windTurbulence: 0.55,
  });
  // Restrained bloom: enough for the rune/wordmark neon to glow without hazing
  // the whole frame; the cinematic look's own (small) vignette is the only one.
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 0.85,
    bloomThreshold: 0.6,
    bloomRadius: 0.7,
    vignetteEnabled: false,
    // Showcase template: default to the High scalability preset so volumetric
    // shafts/shadows/post read well out of the box (autoQuality still steps down).
    quality: 'High',
  });

  // ============================================================================
  // CINEMATIC — 32s: wind → ascent → arrival → runes wake → overload → shatter
  // on the music hit → debris converges into the wordmark.
  // ============================================================================
  const cinematicId = store.createCinematic('The Summit', DURATION);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true, duration: DURATION });
  // Clean look — the letterbox + a light cool grade carry the "film" feel; lens
  // artifacts are kept near zero so the image stays sharp and readable.
  store.setCinematicLook(cinematicId, {
    letterbox: 2.39,
    grade: 'cool',
    gradeIntensity: 0.35,
    grain: 0.02,
    vignette: 0.12,
    motionBlur: 0.08,
    anamorphic: 0.08,
    chromaticAberration: 0,
    lightLeak: 0,
    lensDirt: 0,
  });

  // Open from black.
  store.addCinematicAction(cinematicId, {
    type: 'fade', time: 0, duration: 2.2,
    label: 'Fade in',
    fadeFrom: 1, fadeTo: 0, fadeColor: '#06080f',
  });

  // ---- AUDIO BEATS ----
  if (musicAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 0, label: 'Music: The Summit', soundId: musicAsset.id });
  if (windAsset)  store.addCinematicAction(cinematicId, { type: 'sound', time: 2.0, label: 'Wind gust (the ascent)', soundId: windAsset.id });
  if (swellAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 18.8, label: 'Swell (overload)', soundId: swellAsset.id });
  if (crackAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: SHATTER_TIME - 0.05, label: 'Crack (shatter)', soundId: crackAsset.id });
  if (boomAsset)  store.addCinematicAction(cinematicId, { type: 'sound', time: SHATTER_TIME, label: 'Impact (shatter)', soundId: boomAsset.id });
  if (chimeAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 27.0, label: 'Chime: wordmark', soundId: chimeAsset.id });

  // ---- TIMELINE MARKERS ----
  store.addCinematicMarker(cinematicId, { time: 0,    label: 'Above the clouds', color: '#9fdcff' });
  store.addCinematicMarker(cinematicId, { time: 2.0,  label: 'The ascent',       color: '#cfe4ff' });
  store.addCinematicMarker(cinematicId, { time: 10.6, label: 'Arrival',          color: '#ffd9a0' });
  store.addCinematicMarker(cinematicId, { time: 14,   label: 'The runes wake',   color: '#8fd8ff' });
  store.addCinematicMarker(cinematicId, { time: 17.6, label: 'Communion',        color: '#aeeaff' });
  store.addCinematicMarker(cinematicId, { time: 21.6, label: 'Overload',         color: '#5b8cff' });
  store.addCinematicMarker(cinematicId, { time: SHATTER_TIME, label: 'Shatter',  color: '#eafcff' });
  store.addCinematicMarker(cinematicId, { time: 26.9, label: 'Reveal',           color: '#aeeaff' });

  // ---- THE ASCENT — one keyframed transform track walks the hero up the ridge ----
  // ~1.2 m/s to match the walk loop's cadence; y keys ride the slab tops.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0,
    duration: DURATION,
    label: 'Hero ascent',
    objectId: heroId,
    transformKeyframes: [
      // A held breath at the foot of the ridge (duplicate keys pin the spline flat).
      { time: 0,    position: [13.5, 39.3, 0.15], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 2.0,  position: [13.5, 39.3, 0.15], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 5.5,  position: [9.6, 39.95, 0.08], rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 9.0,  position: [5.8, 40.5, 0],     rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: 10.2, position: [4.2, 40.9, 0],     rotation: [0, 0, 0], scale: [1, 1, 1] },
      // Arrive before the monolith and hold.
      { time: 12.6, position: [0.8, 40.9, 0],     rotation: [0, 0, 0], scale: [1, 1, 1] },
      { time: DURATION, position: [0.8, 40.9, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    ],
  });
  // Acting beats: idle → walk → idle at the monolith. A hidden rig is unmounted, so
  // each clip starts from frame one the moment its rig is revealed.
  if (heroIdleId && heroWalkId) {
    const rigSwaps: Array<{ time: number; label: string; show: string; hide: string }> = [
      { time: 2.0,  label: 'Walk begins',        show: heroWalkId, hide: heroIdleId },
      { time: 12.6, label: 'Stand at the stone', show: heroIdleId, hide: heroWalkId },
    ];
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Hero rigs reset', objectId: heroWalkId, visible: false });
    rigSwaps.forEach(({ time, label, show, hide }) => {
      store.addCinematicAction(cinematicId, { type: 'visibility', time, label, objectId: show, visible: true });
      store.addCinematicAction(cinematicId, { type: 'visibility', time, label, objectId: hide, visible: false });
    });
  }

  // ---- CAMERA — nine chained shots ----
  // Shot 1 · The wind: macro rack-focus on a ridge flag rippling — cloth IS the opening image.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration: 3.0,
    label: 'Shot 1 · The wind (macro)',
    interpolation: 'smooth',
    shake: 0.05,
    shakeFrequency: 0.8,
    keyframes: [
      { time: 0,   position: [13.9, 40.8, 0.7], lookAt: [12.6, 40.5, -1.1], fov: 34, aperture: 4.5, focusDistance: 2.2 },
      { time: 3.0, position: [13.6, 40.7, 0.4], lookAt: [12.6, 40.6, -1.1], fov: 34, aperture: 4.5, focusDistance: 2.0 },
    ],
  });
  // Shot 2 · Above the clouds: wide establishing — the peak, the banner ridge, the tiny hero.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 3.0,
    duration: 3.4,
    label: 'Shot 2 · Above the clouds (wide)',
    interpolation: 'smooth',
    blend: 0.8,
    shake: 0.04,
    shakeFrequency: 0.6,
    keyframes: [
      { time: 3.0, position: [22, 44.5, 16],   lookAt: [2, 41.5, 0], fov: 36, aperture: 1.6, focusDistance: 26 },
      { time: 6.4, position: [19.5, 43.8, 14], lookAt: [2, 41.5, 0], fov: 36, aperture: 1.6, focusDistance: 23 },
    ],
  });
  // Shot 3 · The ascent: follow rig tracking alongside the hero past the streaming flags.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 6.4,
    duration: 4.2,
    label: 'Shot 3 · The ascent (follow)',
    followObjectId: heroId,
    followOffset: [1.8, 0.6, 3.2],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.8,
    fov: 40,
    blend: 1.0,
    shake: 0.07,
    shakeFrequency: 1.0,
  });
  // Shot 4 · Arrival: low static past the monolith's shoulder as the hero walks in and stops.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 10.6,
    duration: 3.2,
    label: 'Shot 4 · Arrival (low front)',
    position: [-2.2, 41.6, 2.8],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.6,
    fov: 44,
    blend: 0.7,
    shake: 0.05,
    shakeFrequency: 0.9,
  });
  // Shot 5 · The runes wake: crane up the monolith face as the glyphs ignite bottom-up.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 13.8,
    duration: 3.8,
    label: 'Shot 5 · The runes wake (crane)',
    interpolation: 'smooth',
    blend: 0.8,
    shake: 0.05,
    shakeFrequency: 0.8,
    keyframes: [
      { time: 13.8, position: [-0.6, 41.0, 2.0], lookAt: [-2.8, 41.6, 0], fov: 40, aperture: 3, focusDistance: 3.2 },
      { time: 17.6, position: [-0.4, 46.4, 2.4], lookAt: [-2.9, 46.0, 0], fov: 40, aperture: 3, focusDistance: 3.4 },
    ],
  });
  // Shot 6 · Communion: a slow keyframed arc around hero + monolith while the charge builds.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 17.6,
    duration: 4.0,
    label: 'Shot 6 · Communion (orbit)',
    interpolation: 'smooth',
    blend: 1.0,
    shake: 0.06,
    shakeFrequency: 0.9,
    keyframes: [
      { time: 17.6, position: [3.8, 42.3, 1.4],  lookAt: [-2.2, 43.4, 0], fov: 38, aperture: 3.4, focusDistance: 6.2 },
      { time: 19.0, position: [1.3, 42.6, 4.8],  lookAt: [-2.2, 43.5, 0], fov: 38, aperture: 3.4, focusDistance: 5.8 },
      { time: 20.4, position: [-2.9, 42.9, 5.3], lookAt: [-2.4, 43.6, 0], fov: 38, aperture: 3.4, focusDistance: 5.3 },
      { time: 21.6, position: [-6.0, 43.1, 3.2], lookAt: [-2.6, 43.7, 0], fov: 38, aperture: 3.4, focusDistance: 4.6 },
    ],
  });
  // Shot 7 · Overload: a tightening push-in on the seam, shake climbing with the swell.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 21.6,
    duration: 1.6,
    label: 'Shot 7 · Overload (push-in)',
    interpolation: 'smooth',
    blend: 0.5,
    shake: 0.12,
    shakeFrequency: 3.5,
    keyframes: [
      { time: 21.6, position: [1.6, 42.0, 1.4], lookAt: [-2.9, 43.4, 0], fov: 30, aperture: 3.5, focusDistance: 4.8 },
      { time: 23.2, position: [0.2, 42.3, 0.7], lookAt: [-2.9, 43.6, 0], fov: 30, aperture: 3.5, focusDistance: 3.6 },
    ],
  });
  // Shot 8a · Shatter framing: locked wide of the summit an instant before the hit...
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 23.2,
    duration: 0.8,
    label: 'Shot 8 · Shatter framing',
    position: [4.2, 41.8, 3.4],
    lookAt: [-3, 43.2, 0],
    fov: 46,
    aperture: 2.4,
    focusDistance: 8,
    blend: 0.4,
    shake: 0.1,
    shakeFrequency: 2.5,
  });
  // ...8b · same framing, violent shake — the cut is invisible, only the shatter lands.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: SHATTER_TIME,
    duration: 2.6,
    label: 'Shot 8 · Shatter shake',
    position: [4.2, 41.8, 3.4],
    lookAt: [-3, 44.0, 0],
    fov: 46,
    aperture: 2.4,
    focusDistance: 8,
    shake: 0.3,
    shakeFrequency: 9,
  });
  // Shot 9 · Reveal crane: rise off the summit and settle on the wordmark over the clouds.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 26.6,
    duration: DURATION - 26.6,
    label: 'Shot 9 · Reveal crane',
    interpolation: 'smooth',
    blend: 1.8,
    shake: 0.04,
    shakeFrequency: 0.6,
    keyframes: [
      { time: 26.6, position: [9, 43.5, 5],      lookAt: [-1.5, 46, 0],   fov: 42, aperture: 3, focusDistance: 11 },
      { time: 29.3, position: [11.5, 49.5, 1.5], lookAt: [-1, 52.0, 0],   fov: 42, aperture: 3, focusDistance: 13 },
      { time: DURATION, position: [12.3, 50.8, 0], lookAt: [-1, 52.4, 0], fov: 42, aperture: 3, focusDistance: 13.5 },
    ],
  });

  // ---- BIRDS — gliding arcs riding the wind during the ascent ----
  birdIds.forEach(({ id, cx, cy, cz, radius, phase }) => {
    const keys: CinematicTransformKeyframe[] = [];
    for (let k = 0; k <= 12; k += 1) {
      const angle = phase + (k / 12) * Math.PI * 3;
      keys.push({
        time: (k / 12) * 14,
        position: [cx + Math.cos(angle) * radius, cy + Math.sin(angle * 0.7) * 0.9, cz + Math.sin(angle) * radius],
        rotation: [0, -angle, 0],
        scale: [0.6, 0.06, 0.18],
      });
    }
    store.addCinematicAction(cinematicId, {
      type: 'transform', time: 0, duration: 14,
      label: 'Bird glide',
      objectId: id,
      transformKeyframes: keys,
    });
  });

  // ---- RUNES WAKE — glyphs flare bottom-up as the hero stands before the stone ----
  runeEntries.forEach(({ id, at, peak }) => {
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: at,
      duration: SHATTER_TIME - at,
      label: 'Rune ignite',
      objectId: id,
      materialKeyframes: [
        { time: at,        emissiveColor: '#8fd8ff', emissiveIntensity: 0 },
        { time: at + 0.2,  emissiveColor: '#eafcff', emissiveIntensity: peak },
        { time: at + 1.2,  emissiveColor: '#8fd8ff', emissiveIntensity: 3.5 },
        { time: SHATTER_TIME, emissiveColor: '#bfe8ff', emissiveIntensity: 6 },
      ],
    });
  });
  // The core seam wakes last, then pulses harder and harder through the overload.
  store.addCinematicAction(cinematicId, {
    type: 'material',
    time: 17.4,
    duration: SHATTER_TIME - 17.4,
    label: 'Core seam overload',
    objectId: seamId,
    materialKeyframes: [
      { time: 17.4, emissiveColor: '#8fd8ff', emissiveIntensity: 0 },
      { time: 17.8, emissiveColor: '#eafcff', emissiveIntensity: 8 },
      { time: 19.0, emissiveColor: '#8fd8ff', emissiveIntensity: 4 },
      { time: 20.4, emissiveColor: '#bfe8ff', emissiveIntensity: 7 },
      { time: 21.6, emissiveColor: '#8fd8ff', emissiveIntensity: 5 },
      { time: 22.8, emissiveColor: '#eafcff', emissiveIntensity: 10 },
      { time: SHATTER_TIME, emissiveColor: '#ffffff', emissiveIntensity: 16 },
    ],
  });
  // Rune light + charge swirl appear with the seam; swirl dies with the stone.
  [monolithLightId, swirlId].forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Charge kit off', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 17.5, label: 'Charge kit on', objectId: id, visible: true });
  });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: SHATTER_TIME, label: 'Charge swirl off', objectId: swirlId, visible: false });

  // ---- THE SHATTER — at t=24 the monolith swaps to flying debris ----
  [monolithId, seamId, ...runeEntries.map((r) => r.id)].forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: SHATTER_TIME, label: 'Monolith gone', objectId: id, visible: false });
  });
  [burstId, sparksId, shockwaveId, impactLightId].forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Shatter kit off', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: SHATTER_TIME, label: 'Shatter kit on', objectId: id, visible: true });
  });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 26.8, label: 'Shatter burst off', objectId: burstId, visible: false });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 27.5, label: 'Shatter sparks off', objectId: sparksId, visible: false });
  shardEntries.forEach(({ id, from, to, spin }) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Shard hidden', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: SHATTER_TIME, label: 'Shard flies', objectId: id, visible: true });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 26.3, label: 'Shard gone', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, {
      type: 'transform',
      time: SHATTER_TIME,
      duration: 1.7,
      label: 'Shard blast',
      objectId: id,
      transformKeyframes: [
        { time: SHATTER_TIME,       position: from, rotation: [0, 0, 0], scale: [1, 1, 1] },
        { time: SHATTER_TIME + 1.7, position: to,   rotation: spin,      scale: [1, 1, 1] },
      ],
    });
  });
  // Shockwave: a flattened sphere disc racing across the plateau while its glow decays.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: SHATTER_TIME,
    duration: 2.2,
    label: 'Shockwave expand',
    objectId: shockwaveId,
    transformKeyframes: [
      { time: SHATTER_TIME,       position: [MONOLITH_POS[0], PLATEAU_TOP_Y + 0.15, 0], rotation: [0, 0, 0], scale: [0.1, 0.05, 0.1] },
      { time: SHATTER_TIME + 2.2, position: [MONOLITH_POS[0], PLATEAU_TOP_Y + 0.15, 0], rotation: [0, 0, 0], scale: [24, 0.05, 24] },
    ],
  });
  store.addCinematicAction(cinematicId, {
    type: 'material',
    time: SHATTER_TIME,
    duration: 2.2,
    label: 'Shockwave glow decay',
    objectId: shockwaveId,
    materialKeyframes: [
      { time: SHATTER_TIME,       emissiveColor: '#ffffff', emissiveIntensity: 9 },
      { time: SHATTER_TIME + 0.4, emissiveColor: '#dffaff', emissiveIntensity: 5 },
      { time: SHATTER_TIME + 2.2, emissiveColor: '#dffaff', emissiveIntensity: 0 },
    ],
  });
  // White-cyan flash on the hit — a dip so it resolves clean on both sides.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: SHATTER_TIME - 0.05,
    duration: 0.9,
    label: 'Shatter flash',
    fadeDip: true,
    fadeFrom: 0,
    fadeTo: 0.9,
    fadeColor: '#dffaff',
  });

  // ---- WORDMARK — strokes fly in from scattered offsets and snap into the logo ----
  // Each stroke is hidden until the shatter, then one small transform track carries it
  // from a deterministic scatter (below/around, toward the dead monolith) to its final
  // local pose, staggered so the logo assembles like debris finding its shape.
  wordmarkStrokes.forEach(({ id, position, scale }, index) => {
    const scatter: Vector3Tuple = [
      position[0] + jitter(index * 3 + 1) * 6.5,
      position[1] - 5.5 + jitter(index * 5 + 2) * 3.5,
      position[2] + jitter(index * 7 + 3) * 3.0,
    ];
    const start = SHATTER_TIME + 0.25 + (index % 9) * 0.045;
    const end = 26.4 + index * 0.012;
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Stroke hidden', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: start, label: 'Stroke flies in', objectId: id, visible: true });
    store.addCinematicAction(cinematicId, {
      type: 'transform',
      time: start,
      duration: end - start,
      label: 'Stroke converge',
      objectId: id,
      transformKeyframes: [
        { time: start, position: scatter,  rotation: [jitter(index + 11) * 2, jitter(index + 13) * 2.5, jitter(index + 19) * 1.8], scale },
        { time: end,   position: position, rotation: [0, 0, 0], scale },
      ],
    });
  });
  // Halos + wordmark light stay dark until the strokes have landed.
  haloIds.forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Halo hidden', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 26.9, label: 'Halo on', objectId: id, visible: true });
  });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Wordmark light off', objectId: logoLightId, visible: false });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 27.0, label: 'Wordmark light on', objectId: logoLightId, visible: true });
  // The neon flicker ignition — per-stroke desync sells the "real sign" feel.
  wordmarkStrokes.forEach(({ id }, index) => {
    const o = (index % 7) * 0.012;
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.0 + o,
      duration: 0.55,
      label: 'Wordmark neon flicker',
      objectId: id,
      interpolation: 'hold',
      materialKeyframes: [
        { time: 27.00 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.05 + o, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
        { time: 27.11 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.20 + o, emissiveColor: '#aeeaff', emissiveIntensity: 8  },
        { time: 27.26 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.36 + o, emissiveColor: '#aeeaff', emissiveIntensity: 5  },
        { time: 27.42 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.50 + o, emissiveColor: '#aeeaff', emissiveIntensity: 6  },
      ],
    });
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.55,
      duration: DURATION - 27.55,
      label: 'Wordmark neon on',
      objectId: id,
      interpolation: 'smooth',
      materialKeyframes: [
        { time: 27.55, emissiveColor: '#aeeaff', emissiveIntensity: 6  },
        { time: 28.20, emissiveColor: '#ffffff', emissiveIntensity: 13 },
        { time: 29.40, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
        { time: DURATION, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
      ],
    });
  });
  haloIds.forEach((id) => {
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.6,
      duration: DURATION - 27.6,
      label: 'Halo neon on',
      objectId: id,
      interpolation: 'smooth',
      materialKeyframes: [
        { time: 27.6,  emissiveColor: '#aeeaff', emissiveIntensity: 0 },
        { time: 28.5,  emissiveColor: '#ffffff', emissiveIntensity: 8 },
        { time: 29.7,  emissiveColor: '#aeeaff', emissiveIntensity: 6 },
        { time: DURATION, emissiveColor: '#aeeaff', emissiveIntensity: 6 },
      ],
    });
  });
  // The wordmark drifts a few degrees through the reveal so it reads alive, not pasted on.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 27,
    duration: DURATION - 27,
    label: 'Wordmark drift',
    objectId: logoEmptyId,
    transformKeyframes: [
      { time: 27,       position: LOGO_POS, rotation: [0, Math.PI / 2 - 0.05, 0], scale: [1, 1, 1] },
      { time: DURATION, position: LOGO_POS, rotation: [0, Math.PI / 2 + 0.05, 0], scale: [1, 1, 1] },
    ],
  });

  // ---- TEXT OVERLAYS — film-style cards riding the ascent ----
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 1.4, duration: 2.8,
    label: 'Opening line',
    text: 'Where the wind never rests',
    textStyle: 'subtitle',
    textColor: '#cfe4ff',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 7.0, duration: 2.8,
    label: 'Presents card',
    text: 'FEATHER ENGINE PRESENTS',
    textStyle: 'title',
    textColor: '#eef6ff',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 12.4, duration: 2.6,
    label: 'Cloth card',
    text: 'REAL-TIME CLOTH · ONE GLOBAL WIND',
    textStyle: 'lowerThird',
    textColor: '#9fdcff',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 18.6, duration: 2.6,
    label: 'Light card',
    text: 'VOLUMETRIC LIGHT · MATERIAL TRACKS',
    textStyle: 'lowerThird',
    textColor: '#8fd8ff',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 28.5, duration: 3.2,
    label: 'Closing tagline',
    text: 'Every frame rendered live in your browser',
    textStyle: 'subtitle',
    textColor: '#dcefff',
  });

  // Close to black + final event.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: DURATION - 1.4,
    duration: 1.4,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#06080f',
  });
  store.addCinematicAction(cinematicId, {
    type: 'event',
    time: DURATION - 0.25,
    label: 'Fire cinematic_finished',
    eventName: 'cinematic_finished',
  });

  store.setActiveCinematic(cinematicId);
  store.selectObject(heroId);
  return cinematicId;
}
