import { getPlatform } from '../platform';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import { inspectModel } from '../three/inspectModel';
import type { AssetItem, CinematicMaterialKeyframe, CinematicTransformKeyframe, Vector3Tuple } from '../types';

/**
 * THE FALL — a 32s God-of-War-style self-running cinematic. A lone hero (the bundled UAL
 * rigged character, acting through real clips: idle → walk to the lip → jump take-off →
 * falling loop, swapped by visibility beats) crosses a ruined cliff-top at dusk, leaps, and
 * plummets the full height of the cliff while the camera dives after them on follow rigs — past rushing rock ledges, runes that ignite as the
 * hero passes, mist bands and embers — into an authored slow-motion beat just above the sea,
 * then a massive impact (white flash + splash particle burst + expanding shockwave + violent
 * camera shake), and finally a crane up out of the spray to the FEATHER ENGINE neon wordmark
 * floating over the water.
 *
 * Engine features on display:
 *   - Follow-rig cameras: the dive is four chained `followObjectId` shots with different
 *     offsets (above/below/ground-rush/slow-mo orbit), blended shot-to-shot, with
 *     `focusObjectId` auto rack-focus locked on the hero.
 *   - Authored slow-mo: the hero's fall is one keyframed transform track whose keys compress
 *     near the water — playback speed never changes, so the 32s music stays in sync.
 *   - Per-shot handheld shake: calm at the edge, buffeting in freefall, near-still in slow-mo,
 *     violent at impact.
 *   - Material tracks (rune + wordmark neon ignition), visibility beats (splash emitters and
 *     impact lights pop on at the exact frame), particles (embers, mist, sea spray, splash),
 *     text overlays, fades (impact white flash via fadeDip), and the film look post stack.
 *
 * Audio (imported from `public/templates/fall/`, with fallbacks from `templates/monolith/`):
 *   - fall_music.wav    — 32s epic orchestral track (quiet dread → freefall → impact → finale)
 *   - wind_rush.mp3     — leap + accelerating wind buffeting
 *   - water_impact.mp3  — the splash
 *   - portal_approach.mp3 / arrival_chime.mp3 — slow-mo swell + wordmark chime (monolith kit)
 *
 * The whole scene is plain primitives + cinematic beats — open the project after Play stops
 * and everything is editable.
 */

const DURATION = 32;
const FALL_AUDIO_DIR = 'templates/fall';
const MONOLITH_AUDIO_DIR = 'templates/monolith';

// Layout: the cliff wall rises along x ≈ -9 from the sea (y=0) to the ruined top (y≈81).
// The hero falls at x ≈ 0..1.6; the camera lives at x > 0, out over the water. The wordmark
// reveal happens at z = -10, framed against the dusk horizon.
const CLIFF_TOP_Y = 81;
const IMPACT_TIME = 24;
const LOGO_Z = -10;

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

function placeLetter(parentId: string, char: string, anchor: Vector3Tuple, cellSize: number, depth: number, emissive: string, intensity: number, letterIndex: number): string[] {
  const store = useEditorStore.getState();
  const strokes = LETTER_STROKES[char];
  if (!strokes) return [];
  const ids: string[] = [];
  strokes.forEach((stroke, strokeIndex) => {
    const [sx, sy, sw, sh] = stroke;
    const cx = anchor[0] + (sx + sw / 2) * cellSize;
    const cy = anchor[1] + (sy + sh / 2) * cellSize;
    const cz = anchor[2];
    const id = store.createObjectWithProps('cube', {
      name: `Logo · ${char}${letterIndex}-${strokeIndex}`,
      position: [cx, cy, cz],
      color: '#02080c',
      parentId,
    });
    store.updateTransform(id, 'scale', [sw * cellSize, sh * cellSize, depth]);
    store.updateRenderer(id, {
      metalness: 0.4,
      roughness: 0.25,
      materialOverrides: { emissiveColor: emissive, emissiveIntensity: intensity },
    });
    ids.push(id);
  });
  return ids;
}

function placeLine(parentId: string, text: string, baselineY: number, z: number, cellSize: number, depth: number, emissive: string, intensity: number): string[] {
  const letterWidth = 5 * cellSize;
  const gap = 1.2 * cellSize;
  const totalWidth = text.length * letterWidth + (text.length - 1) * gap;
  const startX = -totalWidth / 2;
  const ids: string[] = [];
  text.split('').forEach((char, index) => {
    if (char === ' ') return;
    const anchor: Vector3Tuple = [startX + index * (letterWidth + gap), baselineY, z];
    ids.push(...placeLetter(parentId, char, anchor, cellSize, depth, emissive, intensity, index));
  });
  return ids;
}

/** Deterministic jitter in [-1, 1] so the cliff reads as natural rock without RNG. */
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

export async function createFilmModeTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;

  // ============================================================================
  // AUDIO IMPORT — the fall kit, with monolith-kit fallbacks for resilience.
  // ============================================================================
  const audioFolder = store.createFolder('The Fall Audio');
  const musicAsset =
    (await importTemplateAudio(FALL_AUDIO_DIR, 'fall_music.wav', 'audio/wav', audioFolder)) ??
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'walkthrough_music.wav', 'audio/wav', audioFolder));
  const windAsset =
    (await importTemplateAudio(FALL_AUDIO_DIR, 'wind_rush.mp3', 'audio/mpeg', audioFolder)) ??
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'door_whoosh.mp3', 'audio/mpeg', audioFolder));
  const impactAsset =
    (await importTemplateAudio(FALL_AUDIO_DIR, 'water_impact.mp3', 'audio/mpeg', audioFolder)) ??
    (await importTemplateAudio(MONOLITH_AUDIO_DIR, 'door_whoosh.mp3', 'audio/mpeg', audioFolder));
  const swellAsset = await importTemplateAudio(MONOLITH_AUDIO_DIR, 'portal_approach.mp3', 'audio/mpeg', audioFolder);
  const chimeAsset = await importTemplateAudio(MONOLITH_AUDIO_DIR, 'arrival_chime.mp3', 'audio/mpeg', audioFolder);

  // ============================================================================
  // OCEAN — a vast dark dusk sea. The impact point is the world origin.
  // ============================================================================
  const oceanId = store.createObjectWithProps('cube', { name: 'Ocean', position: [0, -0.55, 0], color: '#0a2330' });
  store.updateTransform(oceanId, 'scale', [400, 1, 400]);
  store.updateRenderer(oceanId, { metalness: 0.7, roughness: 0.2 });

  // Sea stacks near the impact point — dark spires the slow-mo shot frames against.
  ([
    { position: [4.5, 1.2, -3.5] as Vector3Tuple, scale: [1.6, 4.5, 1.4] as Vector3Tuple, yaw: 0.4 },
    { position: [-3.5, 0.8, 4.5] as Vector3Tuple, scale: [1.2, 3.2, 1.3] as Vector3Tuple, yaw: -0.7 },
    { position: [7.5, 2.0, 4.0] as Vector3Tuple, scale: [2.0, 6.5, 1.8] as Vector3Tuple, yaw: 1.1 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Sea Stack ${index + 1}`, position: spec.position, color: '#171210' });
    store.updateTransform(id, 'scale', spec.scale);
    store.updateTransform(id, 'rotation', [0.04, spec.yaw, -0.05]);
    store.updateRenderer(id, { metalness: 0.1, roughness: 0.9 });
  });

  // ============================================================================
  // THE CLIFF — a stacked basalt wall from the sea to the ruined top.
  // ============================================================================
  const rockColors = ['#241a16', '#2b201a', '#1d1512'];
  for (let i = 0; i < 14; i += 1) {
    const id = store.createObjectWithProps('cube', {
      name: `Cliff Slab ${i + 1}`,
      position: [-9 + jitter(i) * 0.9, i * 6 + 3, jitter(i + 40) * 4],
      color: rockColors[i % 3],
    });
    store.updateTransform(id, 'scale', [7 + jitter(i + 7) * 1.2, 6.6, 26 + jitter(i + 21) * 5]);
    store.updateTransform(id, 'rotation', [0, jitter(i + 60) * 0.06, 0]);
    store.updateRenderer(id, { metalness: 0.08, roughness: 0.88 });
  }

  // Outcrop ledges protruding into the fall path — the parallax markers the camera whips past.
  [62, 47, 33].forEach((y, index) => {
    const id = store.createObjectWithProps('cube', {
      name: `Cliff Ledge ${index + 1}`,
      position: [-4.4, y, jitter(index + 3) * 5],
      color: '#2b201a',
    });
    store.updateTransform(id, 'scale', [4.5, 1.8, 6 + jitter(index + 11) * 2]);
    store.updateTransform(id, 'rotation', [0.05, jitter(index + 17) * 0.3, -0.06]);
    store.updateRenderer(id, { metalness: 0.08, roughness: 0.85 });
  });

  // Cliff-top platform + ruined pillars — the silhouette the opening shot frames against dusk.
  const platformId = store.createObjectWithProps('cube', { name: 'Cliff Top', position: [-2.5, CLIFF_TOP_Y - 1.0, 0], color: '#241a16' });
  store.updateTransform(platformId, 'scale', [7, 1.6, 9]);
  store.updateRenderer(platformId, { metalness: 0.08, roughness: 0.85 });
  ([
    { position: [-4.2, CLIFF_TOP_Y + 1.6, 2.6] as Vector3Tuple, lean: 0.08 },
    { position: [-4.4, CLIFF_TOP_Y + 1.6, -2.4] as Vector3Tuple, lean: -0.12 },
  ]).forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', { name: `Ruin Pillar ${index + 1}`, position: spec.position, color: '#2b211b' });
    store.updateTransform(id, 'scale', [0.75, 3.6, 0.75]);
    store.updateTransform(id, 'rotation', [spec.lean, 0.3, spec.lean * 0.5]);
    store.updateRenderer(id, { metalness: 0.1, roughness: 0.8 });
  });
  // A fallen lintel between the pillars.
  const lintelId = store.createObjectWithProps('cube', { name: 'Ruin Lintel', position: [-3.6, CLIFF_TOP_Y + 0.1, 0.4], color: '#211812' });
  store.updateTransform(lintelId, 'scale', [0.7, 0.6, 3.4]);
  store.updateTransform(lintelId, 'rotation', [0, 0.5, 0.12]);
  store.updateRenderer(lintelId, { metalness: 0.1, roughness: 0.85 });

  // Brazier embers by the ruins (a small fire bowl + sparks drifting up + its warm light).
  const brazierId = store.createObjectWithProps('cube', { name: 'Brazier', position: [-3.2, CLIFF_TOP_Y + 0.3, 1.6], color: '#3a1c0c' });
  store.updateTransform(brazierId, 'scale', [0.5, 0.35, 0.5]);
  store.updateRenderer(brazierId, { materialOverrides: { emissiveColor: '#ff7a2a', emissiveIntensity: 5 } });
  const embersId = store.createObjectWithProps('empty', { name: 'Brazier Embers', position: [-3.2, CLIFF_TOP_Y + 0.55, 1.6] });
  store.addParticles(embersId, 'sparks');
  store.updateParticles(embersId, { rate: 16, lifetime: 1.8, speed: 1.0, startColor: '#ffb05e', endColor: '#ff4a1a', startSize: 0.06, endSize: 0.01 });
  const topLightId = store.createObjectWithProps('light', { name: 'Cliff Top Light', position: [-2.4, CLIFF_TOP_Y + 2.6, 0.8] });
  store.setObjectLight(topLightId, { type: 'point', color: '#ffb05e', intensity: 11, distance: 18, angle: 0, castShadow: false });

  // ============================================================================
  // CLIFF RUNES — carved tablets down the fall path that ignite as the hero passes.
  // `at` is the cinematic time each one fires, derived from the fall track below.
  // ============================================================================
  const runes: Array<{ y: number; z: number; at: number }> = [
    { y: 58, z: 3.5,  at: 10.0 },
    { y: 50, z: -3.5, at: 11.4 },
    { y: 42, z: 3.5,  at: 12.7 },
    { y: 34, z: -3.5, at: 14.1 },
    { y: 26, z: 3.5,  at: 15.7 },
    { y: 18, z: -3.5, at: 17.5 },
  ];
  const runeEntries: Array<{ id: string; at: number }> = [];
  runes.forEach((spec, index) => {
    const id = store.createObjectWithProps('cube', {
      name: `Cliff Rune ${index + 1}`,
      position: [-4.9, spec.y, spec.z],
      color: '#2a1408',
    });
    store.updateTransform(id, 'scale', [0.15, 1.7, 0.95]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: '#ff9a4d', emissiveIntensity: 0.5 } });
    runeEntries.push({ id, at: spec.at });
  });

  // ============================================================================
  // THE HERO — the bundled UAL rigged character, parented under one empty so a
  // single transform track drives the whole fall. Two model children play manual-
  // mode looping clips (idle / falling); a cinematic visibility swap at the leap
  // switches between them. Falls back to a primitive figure if the model is missing.
  // ============================================================================
  const heroId = store.createObjectWithProps('empty', { name: 'Hero', position: [-3, CLIFF_TOP_Y + 0.7, 0] });
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
  const jumpClipId = pickClip(/jump_start/i, /jump.*start/i, /jump.*up/i);
  const fallClipId = pickClip(/jump_loop/i, /jump.*(loop|air)/i, /falling/i, /in.?air/i, /^jump/i, /fall/i);

  let heroIdleId: string | undefined;
  let heroWalkId: string | undefined;
  let heroJumpId: string | undefined;
  let heroFallId: string | undefined;
  if (heroAssetId && heroMesh && (idleClipId || fallClipId)) {
    const makeHeroModel = (name: string, clipId: string | undefined, loop = true) => {
      // Local offset puts the rig's feet 0.9 below the empty, so the empty sits at the pelvis
      // and the fall's tumble rotation pivots around the body centre, not the feet.
      const id = store.createObjectWithProps('cube', { name, position: [0, -0.9, 0], parentId: heroId });
      store.updateTransform(id, 'rotation', [0, Math.PI / 2, 0]); // rig forward +Z → face +X (the sea)
      store.setObjectModel(id, heroAssetId);
      store.toggleAnimator(id);
      store.updateAnimator(id, { skeletalMeshId: heroMesh.id, animationId: clipId, loop, speed: 1 });
      return id;
    };
    // One model child per acting beat — idle / walk / jump take-off / falling loop. Cinematic
    // visibility beats swap between them; a hidden rig is unmounted, so each clip starts from
    // its first frame the moment its rig is revealed (the jump take-off lands on cue).
    heroIdleId = makeHeroModel('Hero · Idle', idleClipId ?? fallClipId);
    heroWalkId = makeHeroModel('Hero · Walk', walkClipId ?? idleClipId ?? fallClipId);
    heroJumpId = makeHeroModel('Hero · Jump', jumpClipId ?? fallClipId ?? idleClipId, false);
    heroFallId = makeHeroModel('Hero · Falling', fallClipId ?? idleClipId);
  } else {
    // Fallback primitive figure (bundle missing / web fetch failed).
    const bodyId = store.createObjectWithProps('capsule', { name: 'Hero · Body', position: [0, 0, 0], color: '#161018', parentId: heroId });
    store.updateTransform(bodyId, 'scale', [0.45, 0.55, 0.45]);
    store.updateRenderer(bodyId, { metalness: 0.2, roughness: 0.6 });
    const headId = store.createObjectWithProps('sphere', { name: 'Hero · Head', position: [0, 0.66, 0], color: '#1a1216', parentId: heroId });
    store.updateTransform(headId, 'scale', [0.26, 0.26, 0.26]);
    store.updateRenderer(headId, { metalness: 0.2, roughness: 0.55 });
  }

  // ============================================================================
  // BIRDS — three silhouettes circling the cliff top during the opening.
  // ============================================================================
  const birdIds: Array<{ id: string; cx: number; cy: number; cz: number; radius: number; phase: number }> = [];
  for (let i = 0; i < 3; i += 1) {
    const id = store.createObjectWithProps('cube', { name: `Bird ${i + 1}`, position: [2, 72 + i * 3, -2 + i * 3], color: '#0d0a0c' });
    store.updateTransform(id, 'scale', [0.6, 0.06, 0.18]);
    store.updateRenderer(id, { metalness: 0, roughness: 1 });
    birdIds.push({ id, cx: 2, cy: 72 + i * 3, cz: -2 + i * 3, radius: 5 + i * 2, phase: i * 2.1 });
  }

  // ============================================================================
  // ATMOSPHERE — mist bands the hero punches through, and ambient sea spray.
  // ============================================================================
  const mistHighId = store.createObjectWithProps('empty', { name: 'Mist Band High', position: [0, 42, 0] });
  store.addParticles(mistHighId, 'dust');
  store.updateParticles(mistHighId, { rate: 16, shapeRadius: 12, startColor: '#caa890', endColor: '#5e5a66', startSize: 1.2, endSize: 3.4, startOpacity: 0.16 });
  const mistLowId = store.createObjectWithProps('empty', { name: 'Mist Band Low', position: [0, 16, 0] });
  store.addParticles(mistLowId, 'dust');
  store.updateParticles(mistLowId, { rate: 16, shapeRadius: 12, startColor: '#8aa0b0', endColor: '#41506a', startSize: 1.2, endSize: 3.2, startOpacity: 0.16 });
  const sprayId = store.createObjectWithProps('empty', { name: 'Sea Spray', position: [0, 1.0, 0] });
  store.addParticles(sprayId, 'dust');
  store.updateParticles(sprayId, { rate: 12, shapeRadius: 9, startColor: '#9fb8c4', endColor: '#41506a', startSize: 0.5, endSize: 1.8, startOpacity: 0.14 });

  // ============================================================================
  // IMPACT KIT — splash emitters, shockwave disc and impact light, all hidden by
  // visibility beats until the exact impact frame.
  // ============================================================================
  const splashBurstId = store.createObjectWithProps('empty', { name: 'Splash Burst', position: [0.5, 0.3, 0] });
  store.addParticles(splashBurstId, 'sparks');
  store.updateParticles(splashBurstId, { rate: 320, lifetime: 1.3, speed: 9, shapeRadius: 0.6, startColor: '#eafcff', endColor: '#7fb8d4', startSize: 0.16, endSize: 0.03 });
  const splashMistId = store.createObjectWithProps('empty', { name: 'Splash Mist', position: [0.5, 0.6, 0] });
  store.addParticles(splashMistId, 'dust');
  store.updateParticles(splashMistId, { rate: 90, lifetime: 2.4, shapeRadius: 2.6, startColor: '#dff4ff', endColor: '#6e94aa', startSize: 0.6, endSize: 2.8, startOpacity: 0.4 });
  const shockwaveId = store.createObjectWithProps('sphere', { name: 'Shockwave Ring', position: [0.5, 0.12, 0], color: '#dffaff' });
  store.updateTransform(shockwaveId, 'scale', [0.1, 0.04, 0.1]);
  store.updateRenderer(shockwaveId, { opacity: 0.55, materialOverrides: { emissiveColor: '#dffaff', emissiveIntensity: 0 } });
  const impactLightId = store.createObjectWithProps('light', { name: 'Impact Light', position: [0.5, 2.2, 0] });
  store.setObjectLight(impactLightId, { type: 'point', color: '#9fdcff', intensity: 16, distance: 22, angle: 0, castShadow: false });

  // ============================================================================
  // WORDMARK — FEATHER ENGINE in unlit neon over the water, ignited at the reveal.
  // ============================================================================
  const logoEmptyId = store.createObjectWithProps('empty', { name: 'Feather Engine Logo', position: [0, 0, LOGO_Z] });
  const CELL = 0.2;
  const LETTER_DEPTH = 0.18;
  const featherIds = placeLine(logoEmptyId, 'FEATHER', 5.4, 0, CELL, LETTER_DEPTH, '#aeeaff', 0);
  const engineIds  = placeLine(logoEmptyId, 'ENGINE',  3.6, 0, CELL, LETTER_DEPTH, '#aeeaff', 0);
  const wordmarkIds = [...featherIds, ...engineIds];
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
  const logoLightId = store.createObjectWithProps('light', { name: 'Wordmark Light', position: [0, 5, LOGO_Z + 5] });
  store.setObjectLight(logoLightId, { type: 'point', color: '#aeeaff', intensity: 9, distance: 20, angle: 0, castShadow: false });

  // ============================================================================
  // ENVIRONMENT — burnt-orange dusk over a dark sea, fog deepening the vista.
  // ============================================================================
  store.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural',
    skyTopColor: '#1a1030',
    skyHorizonColor: '#ff7a3d',
    skyGroundColor: '#2a1620',
    environmentIntensity: 0.7,
    sunColor: '#ffb05e',
    sunIntensity: 1.3,
    sunElevation: 8,
    sunAzimuth: 100,
    fogEnabled: true,
    fogColor: '#2a1a26',
    fogNear: 40,
    fogFar: 220,
  });
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 1.25,
    bloomThreshold: 0.4,
    bloomRadius: 0.85,
    vignetteEnabled: true,
    // Showcase template: default to the High scalability preset so shadows/post read well out
    // of the box (autoQuality still steps down on weak machines).
    quality: 'High',
  });

  // ============================================================================
  // CINEMATIC — 32s: edge → leap → freefall → slow-mo → impact → reveal.
  // ============================================================================
  const cinematicId = store.createCinematic('The Fall', DURATION);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true, duration: DURATION });
  // Restrained look: the scene must stay readable — the letterbox + a moderate grade do the
  // "film" work, and each lens artifact sits at a level where it's felt, not seen.
  store.setCinematicLook(cinematicId, {
    letterbox: 2.39,
    grade: 'teal-orange',
    gradeIntensity: 0.55,
    grain: 0.05,
    vignette: 0.22,
    motionBlur: 0.25,
    anamorphic: 0.15,
    chromaticAberration: 0.12,
    lightLeak: 0.06,
    lensDirt: 0.12,
  });

  // Open from black.
  store.addCinematicAction(cinematicId, {
    type: 'fade', time: 0, duration: 2.2,
    label: 'Fade in',
    fadeFrom: 1, fadeTo: 0, fadeColor: '#0a060c',
  });

  // ---- AUDIO BEATS ----
  if (musicAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 0, label: 'Music: The Fall', soundId: musicAsset.id });
  if (windAsset)  store.addCinematicAction(cinematicId, { type: 'sound', time: 5.6, label: 'Wind rush (the leap)', soundId: windAsset.id });
  if (swellAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 18.8, label: 'Swell (slow-mo)', soundId: swellAsset.id });
  if (impactAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 23.9, label: 'Water impact', soundId: impactAsset.id });
  if (chimeAsset) store.addCinematicAction(cinematicId, { type: 'sound', time: 26.8, label: 'Chime: wordmark', soundId: chimeAsset.id });

  // ---- TIMELINE MARKERS ----
  store.addCinematicMarker(cinematicId, { time: 0,    label: 'Edge of the world', color: '#ffb05e' });
  store.addCinematicMarker(cinematicId, { time: 1.6,  label: 'The walk',          color: '#ffd9b0' });
  store.addCinematicMarker(cinematicId, { time: 5.4,  label: 'The leap',          color: '#ff7a3d' });
  store.addCinematicMarker(cinematicId, { time: 12,   label: 'Cliff face',        color: '#ff9a4d' });
  store.addCinematicMarker(cinematicId, { time: 16,   label: 'Ground rush',       color: '#ffd24d' });
  store.addCinematicMarker(cinematicId, { time: 19.5, label: 'Slow-mo',           color: '#9fdcff' });
  store.addCinematicMarker(cinematicId, { time: IMPACT_TIME, label: 'Impact',     color: '#eafcff' });
  store.addCinematicMarker(cinematicId, { time: 26.8, label: 'Brand reveal',      color: '#aeeaff' });

  // ---- THE FALL — one keyframed transform track drives the hero ----
  // Freefall speed is authored entirely through key spacing: steady at terminal velocity down
  // the cliff, then the keys compress just above the sea (the slow-mo beat) before a final
  // violent acceleration into the water. Playback speed never changes, so audio stays in sync.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0,
    duration: DURATION,
    label: 'Hero fall',
    objectId: heroId,
    transformKeyframes: [
      // Idle a few metres back from the lip (duplicate keys pin the spline flat through the hold).
      { time: 0,    position: [-3, CLIFF_TOP_Y + 0.7, 0],   rotation: [0, 0, 0],         scale: [1, 1, 1] },
      { time: 1.6,  position: [-3, CLIFF_TOP_Y + 0.7, 0],   rotation: [0, 0, 0],         scale: [1, 1, 1] },
      // The walk to the edge (~1.2 m/s, matching the walk loop's cadence).
      { time: 4.4,  position: [0.1, CLIFF_TOP_Y + 0.7, 0],  rotation: [0, 0, 0],         scale: [1, 1, 1] },
      // A breath at the lip, looking out over the sea.
      { time: 5.4,  position: [0.25, CLIFF_TOP_Y + 0.7, 0], rotation: [0, 0, 0],         scale: [1, 1, 1] },
      // The leap — up and out over the lip.
      { time: 5.8,  position: [1.0, CLIFF_TOP_Y + 1.3, 0],  rotation: [0, 0, -0.15],     scale: [1, 1, 1] },
      { time: 6.3,  position: [1.7, 80.3, 0],               rotation: [0, 0, -0.5],      scale: [1, 1, 1] },
      // Freefall — a restrained head-forward lean with a slow yaw, so the falling animation
      // stays readable instead of being spun into a blur.
      { time: 8.0,  position: [2.0, 72, 0],                 rotation: [0, 0.25, -1.1],   scale: [1, 1, 1] },
      { time: 11.0, position: [2.1, 54, 0],                 rotation: [0, 0.8, -1.45],   scale: [1, 1, 1] },
      { time: 14.0, position: [2.1, 36, 0],                 rotation: [0, 1.4, -1.7],    scale: [1, 1, 1] },
      { time: 17.0, position: [2.0, 21, 0],                 rotation: [0, 1.9, -1.85],   scale: [1, 1, 1] },
      { time: 19.0, position: [1.9, 13.5, 0],               rotation: [0, 2.2, -1.95],   scale: [1, 1, 1] },
      // Slow-mo: descent rate collapses while the camera orbits in close.
      { time: 21.0, position: [1.6, 9, 0],                  rotation: [0, 2.5, -2.05],   scale: [1, 1, 1] },
      { time: 23.0, position: [1.0, 4.8, 0],                rotation: [0, 2.75, -2.15],  scale: [1, 1, 1] },
      // Snap back to full speed — the last metres vanish in half a second.
      { time: 23.6, position: [0.8, 3.0, 0],                rotation: [0, 2.85, -2.2],   scale: [1, 1, 1] },
      { time: IMPACT_TIME, position: [0.6, 0.4, 0],         rotation: [0, 2.95, -2.25],  scale: [1, 1, 1] },
      { time: IMPACT_TIME + 0.3, position: [0.6, -2.5, 0],  rotation: [0, 2.95, -2.25],  scale: [1, 1, 1] },
    ],
  });
  // Acting beats: idle → walk to the edge → a breath at the lip → jump take-off → falling
  // loop. Each rig is revealed exactly when its clip should start (a hidden rig is unmounted,
  // so the clip plays from frame one on reveal); the motion masks every swap.
  if (heroIdleId && heroWalkId && heroJumpId && heroFallId) {
    const rigSwaps: Array<{ time: number; label: string; show?: string; hide: string[] }> = [
      { time: 0,    label: 'Hero rigs reset', hide: [heroWalkId, heroJumpId, heroFallId] },
      { time: 1.6,  label: 'Walk to the edge', show: heroWalkId, hide: [heroIdleId] },
      { time: 4.4,  label: 'Pause at the lip', show: heroIdleId, hide: [heroWalkId] },
      { time: 5.4,  label: 'Jump take-off', show: heroJumpId, hide: [heroIdleId] },
      { time: 6.05, label: 'Falling loop', show: heroFallId, hide: [heroJumpId] },
    ];
    rigSwaps.forEach(({ time, label, show, hide }) => {
      if (show) store.addCinematicAction(cinematicId, { type: 'visibility', time, label, objectId: show, visible: true });
      hide.forEach((id) => store.addCinematicAction(cinematicId, { type: 'visibility', time, label, objectId: id, visible: false }));
    });
  }
  // The hero disappears beneath the surface (children hidden explicitly too, in case the
  // renderer treats visibility per-object rather than per-hierarchy).
  [heroId, heroFallId, heroIdleId, heroWalkId, heroJumpId].filter((id): id is string => Boolean(id)).forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: IMPACT_TIME + 0.45, label: 'Hero underwater', objectId: id, visible: false });
  });

  // ---- CAMERA — chained shots: keyframed opening, follow rigs for the dive ----
  // Shot 1 · Edge of the world: a slow wide push — the ruins, the dusk, the tiny figure.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration: 2.2,
    label: 'Shot 1 · Edge of the world',
    interpolation: 'smooth',
    shake: 0.04,
    shakeFrequency: 0.7,
    keyframes: [
      { time: 0,   position: [15, 85.5, 11], lookAt: [-2, CLIFF_TOP_Y + 1.4, 0], fov: 38, aperture: 2, focusDistance: 20 },
      { time: 2.2, position: [12, 84.5, 9],  lookAt: [-2, CLIFF_TOP_Y + 1.0, 0], fov: 40, aperture: 2.2, focusDistance: 16 },
    ],
  });
  // Shot 2 · The walk: follow rig tracking alongside as the hero crosses the ruins to the lip.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 2.2,
    duration: 3.4,
    label: 'Shot 2 · The walk (follow)',
    followObjectId: heroId,
    followOffset: [2.8, 0.7, 3.4],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.6,
    fov: 42,
    blend: 1.0,
    shake: 0.06,
    shakeFrequency: 0.9,
  });
  // Shot 3 · The leap: locked just below the lip, off to the side — the hero sails overhead
  // and drops past the lens (the aim constraint tracks him the whole way down out of frame).
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 5.6,
    duration: 2.0,
    label: 'Shot 3 · The leap (low angle)',
    position: [2.2, 80.2, -2.6],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.8,
    fov: 50,
    blend: 0.5,
    shake: 0.06,
    shakeFrequency: 1.0,
  });
  // Shot 4 · The dive: follow rig above/behind — the sea yawns far below the hero.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 7.6,
    duration: 4.4,
    label: 'Shot 4 · The dive (follow)',
    followObjectId: heroId,
    followOffset: [4.5, 2.5, 3],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.6,
    fov: 48,
    blend: 1.2,
    shake: 0.1,
    shakeFrequency: 1.6,
  });
  // Shot 5 · Cliff face: follow rig below the hero looking up — sky and rock streak past.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 12,
    duration: 4,
    label: 'Shot 5 · Cliff face (follow)',
    followObjectId: heroId,
    followOffset: [3.0, -1.6, -2.4],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 3,
    fov: 52,
    blend: 1.4,
    shake: 0.14,
    shakeFrequency: 2.0,
  });
  // Shot 6 · Ground rush: high over the hero's shoulder, the sea rushing up to meet the lens.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 16,
    duration: 3.5,
    label: 'Shot 6 · Ground rush (follow)',
    followObjectId: heroId,
    followOffset: [1.6, 3.6, 0.6],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 2.2,
    fov: 56,
    blend: 1.2,
    shake: 0.18,
    shakeFrequency: 2.4,
  });
  // Shot 7 · Slow-mo orbit: long lens in close, near-still air, creamy rack focus on the hero.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 19.5,
    duration: 3.7,
    label: 'Shot 7 · Slow-mo (follow)',
    followObjectId: heroId,
    followOffset: [2.4, 0.4, 1.8],
    lookAtObjectId: heroId,
    focusObjectId: heroId,
    aperture: 5,
    fov: 34,
    blend: 1.6,
    shake: 0.05,
    shakeFrequency: 0.6,
  });
  // Shot 8a · Impact framing: locked low over the water an instant before the hit...
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 23.2,
    duration: 0.8,
    label: 'Shot 8 · Impact framing',
    position: [7, 1.6, 6],
    lookAt: [0.6, 1.4, 0],
    fov: 44,
    aperture: 2.5,
    focusDistance: 9,
    blend: 0.6,
    shake: 0.06,
    shakeFrequency: 1.5,
  });
  // ...8b · same framing, violent shake — the cut is invisible, only the impact lands.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: IMPACT_TIME,
    duration: 3,
    label: 'Shot 8 · Impact shake',
    position: [7, 1.6, 6],
    lookAt: [0.6, 2.2, 0],
    fov: 44,
    aperture: 2.5,
    focusDistance: 9,
    shake: 0.34,
    shakeFrequency: 9,
  });
  // Shot 9 · Reveal crane: rise out of the spray and settle on the wordmark over the sea.
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 27,
    duration: 5,
    label: 'Shot 9 · Reveal crane',
    interpolation: 'smooth',
    blend: 1.8,
    shake: 0.04,
    shakeFrequency: 0.6,
    keyframes: [
      { time: 27,   position: [4, 1.8, 9],   lookAt: [0, 3.0, -6],       fov: 46, aperture: 3, focusDistance: 16 },
      { time: 29.5, position: [0.5, 2.6, 9.5], lookAt: [0, 4.6, LOGO_Z], fov: 42, aperture: 3, focusDistance: 19 },
      { time: 32,   position: [0, 3.4, 8.5],  lookAt: [0, 4.8, LOGO_Z],  fov: 44, aperture: 3, focusDistance: 18 },
    ],
  });

  // ---- BIRDS — circling silhouettes during the opening ----
  birdIds.forEach(({ id, cx, cy, cz, radius, phase }) => {
    const keys: CinematicTransformKeyframe[] = [];
    for (let k = 0; k <= 12; k += 1) {
      const angle = phase + (k / 12) * Math.PI * 4;
      keys.push({
        time: (k / 12) * 14,
        position: [cx + Math.cos(angle) * radius, cy + Math.sin(angle * 0.7) * 0.8, cz + Math.sin(angle) * radius],
        rotation: [0, -angle, 0],
        scale: [0.6, 0.06, 0.18],
      });
    }
    store.addCinematicAction(cinematicId, {
      type: 'transform', time: 0, duration: 14,
      label: 'Bird circle',
      objectId: id,
      transformKeyframes: keys,
    });
  });

  // ---- RUNE IGNITION — each tablet flares as the hero falls past it ----
  runeEntries.forEach(({ id, at }) => {
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: at,
      duration: 1.6,
      label: 'Rune ignite',
      objectId: id,
      materialKeyframes: [
        { time: at,        emissiveColor: '#ff9a4d', emissiveIntensity: 0.5 },
        { time: at + 0.18, emissiveColor: '#ffe9c4', emissiveIntensity: 8   },
        { time: at + 1.6,  emissiveColor: '#ff9a4d', emissiveIntensity: 3   },
      ],
    });
  });

  // ---- IMPACT KIT — everything pops on at the exact frame the hero hits ----
  [splashBurstId, splashMistId, impactLightId].forEach((id) => {
    store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Impact kit off', objectId: id, visible: false });
    store.addCinematicAction(cinematicId, { type: 'visibility', time: IMPACT_TIME, label: 'Impact kit on', objectId: id, visible: true });
  });
  // The dense burst only lives for the plume; the mist keeps churning until the fade.
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 26.5, label: 'Splash burst off', objectId: splashBurstId, visible: false });
  // Shockwave: a flattened sphere disc racing outward while its glow decays.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: IMPACT_TIME,
    duration: 2.2,
    label: 'Shockwave expand',
    objectId: shockwaveId,
    transformKeyframes: [
      { time: IMPACT_TIME,       position: [0.5, 0.12, 0], rotation: [0, 0, 0], scale: [0.1, 0.04, 0.1] },
      { time: IMPACT_TIME + 2.2, position: [0.5, 0.12, 0], rotation: [0, 0, 0], scale: [24, 0.04, 24] },
    ],
  });
  store.addCinematicAction(cinematicId, {
    type: 'material',
    time: IMPACT_TIME,
    duration: 2.2,
    label: 'Shockwave glow decay',
    objectId: shockwaveId,
    materialKeyframes: [
      { time: IMPACT_TIME,       emissiveColor: '#ffffff', emissiveIntensity: 9 },
      { time: IMPACT_TIME + 0.4, emissiveColor: '#dffaff', emissiveIntensity: 5 },
      { time: IMPACT_TIME + 2.2, emissiveColor: '#dffaff', emissiveIntensity: 0 },
    ],
  });
  // White flash on the hit — a dip so it resolves clean on both sides.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: IMPACT_TIME - 0.05,
    duration: 0.9,
    label: 'Impact flash',
    fadeDip: true,
    fadeFrom: 0,
    fadeTo: 0.9,
    fadeColor: '#eafcff',
  });

  // ---- WORDMARK — hidden light until the reveal, then the neon flicker ignition ----
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 0, label: 'Wordmark light off', objectId: logoLightId, visible: false });
  store.addCinematicAction(cinematicId, { type: 'visibility', time: 26.8, label: 'Wordmark light on', objectId: logoLightId, visible: true });
  wordmarkIds.forEach((id, index) => {
    const o = (index % 7) * 0.012; // 0–72ms desync per stroke sells the "real sign" feel
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 26.8 + o,
      duration: 0.55,
      label: 'Wordmark neon flicker',
      objectId: id,
      interpolation: 'hold',
      materialKeyframes: [
        { time: 26.80 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 26.85 + o, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
        { time: 26.91 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.00 + o, emissiveColor: '#aeeaff', emissiveIntensity: 8  },
        { time: 27.06 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.16 + o, emissiveColor: '#aeeaff', emissiveIntensity: 5  },
        { time: 27.22 + o, emissiveColor: '#0a1424', emissiveIntensity: 0  },
        { time: 27.30 + o, emissiveColor: '#aeeaff', emissiveIntensity: 6  },
      ],
    });
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.35,
      duration: DURATION - 27.35,
      label: 'Wordmark neon on',
      objectId: id,
      interpolation: 'smooth',
      materialKeyframes: [
        { time: 27.35, emissiveColor: '#aeeaff', emissiveIntensity: 6  },
        { time: 28.00, emissiveColor: '#ffffff', emissiveIntensity: 13 },
        { time: 29.20, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
        { time: DURATION, emissiveColor: '#aeeaff', emissiveIntensity: 11 },
      ],
    });
  });
  haloIds.forEach((id) => {
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.4,
      duration: DURATION - 27.4,
      label: 'Halo neon on',
      objectId: id,
      interpolation: 'smooth',
      materialKeyframes: [
        { time: 27.4,  emissiveColor: '#aeeaff', emissiveIntensity: 0 },
        { time: 28.3,  emissiveColor: '#ffffff', emissiveIntensity: 8 },
        { time: 29.5,  emissiveColor: '#aeeaff', emissiveIntensity: 6 },
        { time: DURATION, emissiveColor: '#aeeaff', emissiveIntensity: 6 },
      ],
    });
  });
  // The wordmark drifts a few degrees through the reveal so it reads alive, not pasted on.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 24,
    duration: DURATION - 24,
    label: 'Wordmark drift',
    objectId: logoEmptyId,
    transformKeyframes: [
      { time: 24,       position: [0, 0, LOGO_Z], rotation: [0, -0.06, 0], scale: [1, 1, 1] },
      { time: DURATION, position: [0, 0, LOGO_Z], rotation: [0,  0.06, 0], scale: [1, 1, 1] },
    ],
  });

  // ---- TEXT OVERLAYS — film-style cards riding the fall ----
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 1.6, duration: 2.8,
    label: 'Opening line',
    text: 'At the edge of the world',
    textStyle: 'subtitle',
    textColor: '#ffd9b0',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 7.2, duration: 2.8,
    label: 'Presents card',
    text: 'FEATHER ENGINE PRESENTS',
    textStyle: 'title',
    textColor: '#fff3e0',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 12.5, duration: 2.6,
    label: 'Real-time card',
    text: 'A REAL-TIME CINEMATIC · NO PRE-RENDER',
    textStyle: 'lowerThird',
    textColor: '#ffb877',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 20.2, duration: 2.6,
    label: 'Slow-mo card',
    text: 'AUTHORED SLOW-MO · FOLLOW-RIG CAMERAS',
    textStyle: 'lowerThird',
    textColor: '#9fdcff',
  });
  store.addCinematicAction(cinematicId, {
    type: 'text', time: 28.4, duration: 3.2,
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
    fadeColor: '#0a060c',
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
