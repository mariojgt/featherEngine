import { getPlatform } from '../platform';
import { useEditorStore } from '../store/editorStore';
import { useProjectStore } from '../store/projectStore';
import type { AssetItem, Vector3Tuple } from '../types';

/**
 * Feather Engine Walkthrough — a 32s self-running cinematic that opens with the camera at
 * the mouth of a sci-fi corridor, walks the viewer through three showcase rooms (each one
 * highlights a different engine feature with its own light + color theme), and arrives at
 * the hero monolith with the FEATHER ENGINE 3D wordmark floating above it.
 *
 *   Room 1 — LIGHTING   : amber/gold theme. Multiple coloured point lights down the room,
 *                         visible "lamp" cubes, bloom + emissive trim — shows off dynamic
 *                         lighting + bloom post-fx.
 *   Room 2 — MATERIALS  : cool cyan theme. A row of 5 PBR spheres on pedestals (chrome /
 *                         brushed metal / gold / glossy red / matte blue) under a clean
 *                         top light — shows off the PBR material system (metalness/roughness).
 *   Room 3 — PARTICLES  : magenta/purple theme. Magic + sparks + dust emitters and a couple
 *                         of orbital wisps — shows off the particle system.
 *   Monolith Chamber    : clean wide chamber, soft cyan lighting. Hero monolith + FEATHER
 *                         ENGINE 3D wordmark above it, with subtle reveal — NO lightning,
 *                         no aurora sky, no flash VFX. The brand reveal speaks for itself.
 *
 * Audio (all imported from `public/templates/monolith/`):
 *   - walkthrough_music.wav — 32s gentle exploratory orchestral bed
 *   - door_whoosh.mp3        — sci-fi door whoosh, fired 3× at room transitions
 *   - arrival_chime.mp3      — shimmering bell + brass swell at the wordmark reveal
 *
 * The whole scene is plain primitives + cinematic `sound` beats — open the project after
 * Play stops and everything is editable.
 */

const DURATION = 32;
const MONOLITH_AUDIO_DIR = 'templates/monolith';

// Corridor + room layout along -Z (camera looks down -Z from its start position).
const ROOM_W = 14;
const ROOM_H = 5;
const CORRIDOR_W = 5;
const ROOM1_CENTER_Z = -14;
const ROOM2_CENTER_Z = -36;
const ROOM3_CENTER_Z = -58;
const ROOM_LEN = 16; // each room spans 16m along z
const MONOLITH_Z = -85;
const CHAMBER_FAR_Z = -100;

async function importMonolithAudio(file: string, mimeType: string, folderId?: string): Promise<AssetItem | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === file && a.type === 'audio');
  if (existing) return existing;
  try {
    const response = await fetch(`${MONOLITH_AUDIO_DIR}/${file}`);
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

// ============================================================================
// ARCHITECTURE HELPERS — walls, floors, archways for the corridor + rooms.
// ============================================================================

interface ChamberOpts {
  name: string;
  centerZ: number;
  width: number;
  length: number;
  height: number;
  floorColor: string;
  wallColor: string;
  trimColor: string;
  trimIntensity: number;
}

/** Build one chamber (floor + ceiling + two side walls + emissive trim strips along the floor edges). */
function buildChamber(opts: ChamberOpts) {
  const store = useEditorStore.getState();
  const halfLen = opts.length / 2;
  const halfW = opts.width / 2;

  // Floor.
  const floorId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Floor`,
    position: [0, -0.15, opts.centerZ],
    color: opts.floorColor,
  });
  store.updateTransform(floorId, 'scale', [opts.width, 0.3, opts.length]);
  store.updateRenderer(floorId, { metalness: 0.2, roughness: 0.7 });

  // Ceiling.
  const ceilingId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Ceiling`,
    position: [0, opts.height + 0.15, opts.centerZ],
    color: opts.floorColor,
  });
  store.updateTransform(ceilingId, 'scale', [opts.width, 0.3, opts.length]);
  store.updateRenderer(ceilingId, { metalness: 0.2, roughness: 0.7 });

  // Side walls.
  const leftWallId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Wall L`,
    position: [-halfW - 0.15, opts.height / 2, opts.centerZ],
    color: opts.wallColor,
  });
  store.updateTransform(leftWallId, 'scale', [0.3, opts.height, opts.length]);
  store.updateRenderer(leftWallId, { metalness: 0.15, roughness: 0.6 });

  const rightWallId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Wall R`,
    position: [halfW + 0.15, opts.height / 2, opts.centerZ],
    color: opts.wallColor,
  });
  store.updateTransform(rightWallId, 'scale', [0.3, opts.height, opts.length]);
  store.updateRenderer(rightWallId, { metalness: 0.15, roughness: 0.6 });

  // Emissive trim strip along the bottom of each wall — the signature "this is a sci-fi room" read.
  const trimLId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Trim L`,
    position: [-halfW + 0.12, 0.18, opts.centerZ],
    color: opts.trimColor,
  });
  store.updateTransform(trimLId, 'scale', [0.06, 0.12, opts.length - 0.4]);
  store.updateRenderer(trimLId, { materialOverrides: { emissiveColor: opts.trimColor, emissiveIntensity: opts.trimIntensity } });

  const trimRId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Trim R`,
    position: [halfW - 0.12, 0.18, opts.centerZ],
    color: opts.trimColor,
  });
  store.updateTransform(trimRId, 'scale', [0.06, 0.12, opts.length - 0.4]);
  store.updateRenderer(trimRId, { materialOverrides: { emissiveColor: opts.trimColor, emissiveIntensity: opts.trimIntensity } });

  // Ceiling trim too — frames the room from above.
  const ceilTrimLId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Ceil Trim L`,
    position: [-halfW + 0.12, opts.height - 0.18, opts.centerZ],
    color: opts.trimColor,
  });
  store.updateTransform(ceilTrimLId, 'scale', [0.06, 0.08, opts.length - 0.4]);
  store.updateRenderer(ceilTrimLId, { materialOverrides: { emissiveColor: opts.trimColor, emissiveIntensity: opts.trimIntensity * 0.7 } });

  const ceilTrimRId = store.createObjectWithProps('cube', {
    name: `${opts.name} · Ceil Trim R`,
    position: [halfW - 0.12, opts.height - 0.18, opts.centerZ],
    color: opts.trimColor,
  });
  store.updateTransform(ceilTrimRId, 'scale', [0.06, 0.08, opts.length - 0.4]);
  store.updateRenderer(ceilTrimRId, { materialOverrides: { emissiveColor: opts.trimColor, emissiveIntensity: opts.trimIntensity * 0.7 } });

  return { floorId, ceilingId, leftWallId, rightWallId };
}

/** Emissive doorway archway at z — left + right posts + top crossbar. Used at room boundaries. */
function buildArchway(name: string, z: number, width: number, height: number, color: string, intensity: number) {
  const store = useEditorStore.getState();
  const halfW = width / 2;
  // Left post.
  const left = store.createObjectWithProps('cube', { name: `${name} · L`, position: [-halfW, height / 2, z], color });
  store.updateTransform(left, 'scale', [0.18, height, 0.18]);
  store.updateRenderer(left, { materialOverrides: { emissiveColor: color, emissiveIntensity: intensity } });
  // Right post.
  const right = store.createObjectWithProps('cube', { name: `${name} · R`, position: [halfW, height / 2, z], color });
  store.updateTransform(right, 'scale', [0.18, height, 0.18]);
  store.updateRenderer(right, { materialOverrides: { emissiveColor: color, emissiveIntensity: intensity } });
  // Top crossbar.
  const top = store.createObjectWithProps('cube', { name: `${name} · Top`, position: [0, height - 0.05, z], color });
  store.updateTransform(top, 'scale', [width + 0.18, 0.18, 0.18]);
  store.updateRenderer(top, { materialOverrides: { emissiveColor: color, emissiveIntensity: intensity } });
}

export async function createFilmModeTemplate(): Promise<string | undefined> {
  const store = useEditorStore.getState();
  const scene = store.activeScene();
  if (!scene) return undefined;

  // ============================================================================
  // AUDIO IMPORT.
  // ============================================================================
  const audioFolder = store.createFolder('Walkthrough Audio');
  const musicAsset   = await importMonolithAudio('walkthrough_music.wav', 'audio/wav', audioFolder);
  const whooshAsset  = await importMonolithAudio('door_whoosh.mp3', 'audio/mpeg', audioFolder);
  const portalAsset  = await importMonolithAudio('portal_approach.mp3', 'audio/mpeg', audioFolder);
  const chimeAsset   = await importMonolithAudio('arrival_chime.mp3', 'audio/mpeg', audioFolder);

  // ============================================================================
  // ENTRY CORRIDOR (z=0 → z=-6).
  // ============================================================================
  buildChamber({
    name: 'Entry',
    centerZ: -3,
    width: CORRIDOR_W,
    length: 8,
    height: 3.6,
    floorColor: '#1a1a22',
    wallColor: '#15151c',
    trimColor: '#5acbff',
    trimIntensity: 4,
  });
  // Soft ceiling light in the entry corridor so the camera start frame isn't pitch black.
  const entryLightId = store.createObjectWithProps('light', { name: 'Entry Light', position: [0, 3.0, -3] });
  store.setObjectLight(entryLightId, { type: 'point', color: '#aeeaff', intensity: 6, distance: 9, angle: 0, castShadow: false });

  // ============================================================================
  // ROOM 1 — LIGHTING showcase (amber/gold theme).
  // ============================================================================
  buildChamber({
    name: 'Room 1',
    centerZ: ROOM1_CENTER_Z,
    width: ROOM_W,
    length: ROOM_LEN,
    height: ROOM_H,
    floorColor: '#1a140c',
    wallColor: '#221a10',
    trimColor: '#ff9a4d',
    trimIntensity: 4.5,
  });
  buildArchway('Room 1 Entry Arch', -6, CORRIDOR_W + 0.4, 3.6, '#ff9a4d', 3.5);

  // Six "lamp" emissive cubes hanging from the ceiling, each paired with a point light. Lights
  // step through warm hues so the room reads as a procession of lamps.
  const room1Lights: Array<{ z: number; color: string }> = [
    { z: ROOM1_CENTER_Z - 5, color: '#ff6b3d' },
    { z: ROOM1_CENTER_Z - 5, color: '#ff6b3d' },
    { z: ROOM1_CENTER_Z,     color: '#ffd24d' },
    { z: ROOM1_CENTER_Z,     color: '#ffd24d' },
    { z: ROOM1_CENTER_Z + 5, color: '#ff9a4d' },
    { z: ROOM1_CENTER_Z + 5, color: '#ff9a4d' },
  ];
  room1Lights.forEach((spec, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    // Visible lamp cube.
    const lampId = store.createObjectWithProps('cube', {
      name: `R1 Lamp ${index + 1}`,
      position: [side * 4.5, ROOM_H - 0.6, spec.z],
      color: spec.color,
    });
    store.updateTransform(lampId, 'scale', [0.35, 0.25, 0.35]);
    store.updateRenderer(lampId, { materialOverrides: { emissiveColor: spec.color, emissiveIntensity: 9 } });
    // Point light next to it.
    const lid = store.createObjectWithProps('light', {
      name: `R1 Light ${index + 1}`,
      position: [side * 4.0, ROOM_H - 1.1, spec.z],
    });
    store.setObjectLight(lid, { type: 'point', color: spec.color, intensity: 14, distance: 12, angle: 0, castShadow: false });
  });

  // A couple of pedestal cubes down the room to catch the warm lighting.
  [-5, 0, 5].forEach((dz, index) => {
    const id = store.createObjectWithProps('cube', {
      name: `R1 Pedestal ${index + 1}`,
      position: [0, 0.6, ROOM1_CENTER_Z + dz],
      color: '#2a1c0e',
    });
    store.updateTransform(id, 'scale', [1.2, 1.2, 1.2]);
    store.updateRenderer(id, { metalness: 0.35, roughness: 0.45 });
  });

  buildArchway('Room 1 Exit Arch', -22, CORRIDOR_W + 0.4, 3.6, '#ff9a4d', 3.5);

  // ============================================================================
  // CORRIDOR BETWEEN ROOM 1 AND ROOM 2 (z=-22 → -28).
  // ============================================================================
  buildChamber({
    name: 'Corridor 1-2',
    centerZ: -25,
    width: CORRIDOR_W,
    length: 6,
    height: 3.6,
    floorColor: '#15151c',
    wallColor: '#10101a',
    trimColor: '#7aa8ff',
    trimIntensity: 3,
  });

  // ============================================================================
  // ROOM 2 — MATERIALS showcase (cool cyan theme, 5 PBR spheres).
  // ============================================================================
  buildChamber({
    name: 'Room 2',
    centerZ: ROOM2_CENTER_Z,
    width: ROOM_W,
    length: ROOM_LEN,
    height: ROOM_H,
    floorColor: '#0e1a22',
    wallColor: '#10202c',
    trimColor: '#4dd0ff',
    trimIntensity: 4.5,
  });
  buildArchway('Room 2 Entry Arch', -28, CORRIDOR_W + 0.4, 3.6, '#4dd0ff', 3.5);

  // Five spheres on pedestals demonstrating different PBR materials.
  const materialShowcase: Array<{ z: number; color: string; metalness: number; roughness: number; name: string }> = [
    { z: ROOM2_CENTER_Z - 6,   color: '#f0f0f0', metalness: 1.0, roughness: 0.04, name: 'Chrome'    },
    { z: ROOM2_CENTER_Z - 3,   color: '#d0d0d0', metalness: 1.0, roughness: 0.30, name: 'Brushed'   },
    { z: ROOM2_CENTER_Z,       color: '#d9b06a', metalness: 1.0, roughness: 0.18, name: 'Gold'      },
    { z: ROOM2_CENTER_Z + 3,   color: '#c93b3b', metalness: 0.0, roughness: 0.18, name: 'Lacquer'   },
    { z: ROOM2_CENTER_Z + 6,   color: '#3b6bc9', metalness: 0.0, roughness: 0.85, name: 'Matte'     },
  ];
  materialShowcase.forEach((spec, index) => {
    // Pedestal.
    const pedId = store.createObjectWithProps('cube', {
      name: `R2 Pedestal ${spec.name}`,
      position: [0, 0.4, spec.z],
      color: '#152432',
    });
    store.updateTransform(pedId, 'scale', [0.9, 0.8, 0.9]);
    store.updateRenderer(pedId, { metalness: 0.25, roughness: 0.55 });
    // Sphere.
    const sphereId = store.createObjectWithProps('sphere', {
      name: `R2 Sphere · ${spec.name}`,
      position: [0, 1.35, spec.z],
      color: spec.color,
    });
    store.updateTransform(sphereId, 'scale', [0.55, 0.55, 0.55]);
    store.updateRenderer(sphereId, { metalness: spec.metalness, roughness: spec.roughness });
    // Label glow under each sphere (very subtle).
    const labelId = store.createObjectWithProps('cube', {
      name: `R2 Label ${spec.name}`,
      position: [0, 0.05, spec.z],
      color: '#4dd0ff',
    });
    store.updateTransform(labelId, 'scale', [0.85, 0.04, 0.85]);
    store.updateRenderer(labelId, { materialOverrides: { emissiveColor: '#4dd0ff', emissiveIntensity: 3.5 } });
  });

  // Two clean top lights illuminate the sphere row (cool white so material colors read true).
  [-1, 1].forEach((dz, index) => {
    const id = store.createObjectWithProps('light', {
      name: `R2 Top Light ${index + 1}`,
      position: [0, ROOM_H - 0.8, ROOM2_CENTER_Z + dz * 4],
    });
    store.setObjectLight(id, { type: 'point', color: '#dceeff', intensity: 16, distance: 14, angle: 0, castShadow: false });
  });
  // Side-fill in cyan.
  [-1, 1].forEach((sx, index) => {
    const id = store.createObjectWithProps('light', {
      name: `R2 Fill Light ${index + 1}`,
      position: [sx * 5, 2.5, ROOM2_CENTER_Z],
    });
    store.setObjectLight(id, { type: 'point', color: '#4dd0ff', intensity: 6, distance: 10, angle: 0, castShadow: false });
  });

  buildArchway('Room 2 Exit Arch', -44, CORRIDOR_W + 0.4, 3.6, '#4dd0ff', 3.5);

  // ============================================================================
  // CORRIDOR BETWEEN ROOM 2 AND ROOM 3 (z=-44 → -50).
  // ============================================================================
  buildChamber({
    name: 'Corridor 2-3',
    centerZ: -47,
    width: CORRIDOR_W,
    length: 6,
    height: 3.6,
    floorColor: '#15151c',
    wallColor: '#10101a',
    trimColor: '#a87aff',
    trimIntensity: 3,
  });

  // ============================================================================
  // ROOM 3 — PARTICLES showcase (magenta/purple theme).
  // ============================================================================
  buildChamber({
    name: 'Room 3',
    centerZ: ROOM3_CENTER_Z,
    width: ROOM_W,
    length: ROOM_LEN,
    height: ROOM_H,
    floorColor: '#150e22',
    wallColor: '#1a1230',
    trimColor: '#c44dff',
    trimIntensity: 4.5,
  });
  buildArchway('Room 3 Entry Arch', -50, CORRIDOR_W + 0.4, 3.6, '#c44dff', 3.5);

  // Magic particle emitter (centred, drifts upward).
  const magicEmitterId = store.createObjectWithProps('empty', {
    name: 'R3 Magic Emitter',
    position: [-3, 0.6, ROOM3_CENTER_Z - 4],
  });
  store.addParticles(magicEmitterId, 'magic');
  store.updateParticles(magicEmitterId, { rate: 38, lifetime: 2.4, speed: 1.1, shapeRadius: 0.8, startColor: '#e6b3ff', endColor: '#7a3dc9', startSize: 0.16, endSize: 0.02, light: false });

  // Sparks emitter — fountain-like rising sparks.
  const sparksEmitterId = store.createObjectWithProps('empty', {
    name: 'R3 Sparks Emitter',
    position: [3, 0.4, ROOM3_CENTER_Z],
  });
  store.addParticles(sparksEmitterId, 'sparks');
  store.updateParticles(sparksEmitterId, { rate: 60, lifetime: 0.9, speed: 4.5, startColor: '#ffd6ff', endColor: '#c44dff' });

  // Dust haze — soft floating dust.
  const dustEmitterId = store.createObjectWithProps('empty', {
    name: 'R3 Dust Emitter',
    position: [0, 0.2, ROOM3_CENTER_Z + 4],
  });
  store.addParticles(dustEmitterId, 'dust');
  store.updateParticles(dustEmitterId, { rate: 22, shapeRadius: 4.5, startColor: '#5a3a8a', endColor: '#241846', startSize: 0.35, endSize: 1.6, startOpacity: 0.22 });

  // 3 orbital wisps (small glowing spheres) for visual motion.
  [{ x: -3, y: 2.0, z: -6 }, { x: 0, y: 3.0, z: 0 }, { x: 3, y: 2.5, z: 6 }].forEach((o, index) => {
    const id = store.createObjectWithProps('sphere', {
      name: `R3 Wisp ${index + 1}`,
      position: [o.x, o.y, ROOM3_CENTER_Z + o.z],
      color: '#1a0a2a',
    });
    store.updateTransform(id, 'scale', [0.22, 0.22, 0.22]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: '#e6b3ff', emissiveIntensity: 6 } });
  });

  // Soft purple ambient lighting (low intensity, set the mood).
  [-1, 1].forEach((sx, index) => {
    const id = store.createObjectWithProps('light', {
      name: `R3 Fill Light ${index + 1}`,
      position: [sx * 5, 3.5, ROOM3_CENTER_Z],
    });
    store.setObjectLight(id, { type: 'point', color: '#c44dff', intensity: 10, distance: 14, angle: 0, castShadow: false });
  });

  buildArchway('Room 3 Exit Arch', -66, CORRIDOR_W + 0.4, 3.6, '#c44dff', 3.5);

  // ============================================================================
  // FINAL TRANSITION CORRIDOR (z=-66 → -72).
  // ============================================================================
  buildChamber({
    name: 'Final Corridor',
    centerZ: -69,
    width: CORRIDOR_W,
    length: 6,
    height: 3.6,
    floorColor: '#0a1018',
    wallColor: '#0c1422',
    trimColor: '#aeeaff',
    trimIntensity: 3.5,
  });
  buildArchway('Chamber Entry Arch', -72, 10, 5.5, '#aeeaff', 5);

  // ============================================================================
  // MONOLITH CHAMBER (z=-72 → -100). The destination. Clean. No lightning. No
  // aurora sky. Just the hero monolith + FEATHER ENGINE wordmark + soft light.
  // ============================================================================
  buildChamber({
    name: 'Chamber',
    centerZ: -86,
    width: 22,
    length: 28,
    height: 12,
    floorColor: '#08121a',
    wallColor: '#0a1424',
    trimColor: '#aeeaff',
    trimIntensity: 4,
  });

  // Hero monolith.
  const monolithId = store.createObjectWithProps('cube', { name: 'Monolith', position: [0, 4, MONOLITH_Z], color: '#040406' });
  store.updateTransform(monolithId, 'scale', [1.4, 8, 0.3]);
  store.updateRenderer(monolithId, { metalness: 0.7, roughness: 0.08 });

  // Inscription on the monolith front face.
  const inscriptionId = store.createObjectWithProps('cube', {
    name: 'Monolith Inscription',
    position: [0, 4.6, MONOLITH_Z + 0.18],
    color: '#08111c',
  });
  store.updateTransform(inscriptionId, 'scale', [0.7, 1.6, 0.04]);
  // Inscription starts as a very faint glow so the monolith has presence as the camera approaches,
  // then lifts to brand-bright alongside the wordmark neon-on.
  store.updateRenderer(inscriptionId, {
    metalness: 0.3,
    roughness: 0.3,
    materialOverrides: { emissiveColor: '#3ad6ff', emissiveIntensity: 1.2 },
  });

  // FEATHER ENGINE wordmark — parented under a single Logo empty above the monolith.
  const logoEmptyId = store.createObjectWithProps('empty', { name: 'Feather Engine Logo', position: [0, 0, MONOLITH_Z] });
  const CELL = 0.18;
  const LETTER_DEPTH = 0.16;
  const LOGO_Z_LOCAL = 0.6;
  const TOP_BASELINE = 9.6;
  const BOTTOM_BASELINE = 7.9;
  // Wordmark starts UNLIT — emissive intensity 0 on every letter cube. The neon flicker reveal
  // at t=27 turns it on the way a real neon sign does (rapid stuttering before settling bright).
  const featherIds = placeLine(logoEmptyId, 'FEATHER', TOP_BASELINE, LOGO_Z_LOCAL, CELL, LETTER_DEPTH, '#aeeaff', 0);
  const engineIds  = placeLine(logoEmptyId, 'ENGINE',  BOTTOM_BASELINE, LOGO_Z_LOCAL, CELL, LETTER_DEPTH, '#aeeaff', 0);
  const wordmarkIds = [...featherIds, ...engineIds];

  // Halo bars also start dark — they bloom on with the neon flicker.
  const haloTopId = store.createObjectWithProps('cube', {
    name: 'Halo · FEATHER',
    position: [0, 4 + TOP_BASELINE + (CELL * 7) / 2, MONOLITH_Z + LOGO_Z_LOCAL - 0.18],
    color: '#0a1424',
  });
  store.updateTransform(haloTopId, 'scale', [9.5, 1.7, 0.08]);
  store.updateRenderer(haloTopId, { opacity: 0.22, materialOverrides: { emissiveColor: '#aeeaff', emissiveIntensity: 0 } });

  const haloBottomId = store.createObjectWithProps('cube', {
    name: 'Halo · ENGINE',
    position: [0, 4 + BOTTOM_BASELINE + (CELL * 7) / 2, MONOLITH_Z + LOGO_Z_LOCAL - 0.18],
    color: '#0a1424',
  });
  store.updateTransform(haloBottomId, 'scale', [8.0, 1.7, 0.08]);
  store.updateRenderer(haloBottomId, { opacity: 0.22, materialOverrides: { emissiveColor: '#aeeaff', emissiveIntensity: 0 } });

  // Four subtle floor runes around the monolith (much smaller than the previous 12-stone ring).
  [[3, 0, MONOLITH_Z + 3], [-3, 0, MONOLITH_Z + 3], [3, 0, MONOLITH_Z - 3], [-3, 0, MONOLITH_Z - 3]].forEach((pos, index) => {
    const id = store.createObjectWithProps('cube', {
      name: `Floor Rune ${index + 1}`,
      position: pos as Vector3Tuple,
      color: '#1a1428',
    });
    store.updateTransform(id, 'scale', [1.0, 0.06, 0.5]);
    store.updateRenderer(id, { materialOverrides: { emissiveColor: '#aeeaff', emissiveIntensity: 2.2 } });
  });

  // Soft top light over the monolith — single clean cyan key light for the brand reveal.
  const chamberKeyId = store.createObjectWithProps('light', { name: 'Chamber Key Light', position: [0, 10, MONOLITH_Z + 4] });
  store.setObjectLight(chamberKeyId, { type: 'point', color: '#aeeaff', intensity: 12, distance: 22, angle: 0, castShadow: false });
  // Fill from below for a hint of rim on the monolith front.
  const chamberFillId = store.createObjectWithProps('light', { name: 'Chamber Fill', position: [0, 1.5, MONOLITH_Z + 8] });
  store.setObjectLight(chamberFillId, { type: 'point', color: '#3a6cff', intensity: 4, distance: 14, angle: 0, castShadow: false });

  // ============================================================================
  // ENVIRONMENT — dark sky + light fog tuned for the corridor walkthrough.
  // ============================================================================
  store.updateSceneEnvironment(scene.id, {
    skyMode: 'procedural',
    skyTopColor: '#020308',
    skyHorizonColor: '#0a0a18',
    skyGroundColor: '#040406',
    environmentIntensity: 0.18,
    sunColor: '#5a6cff',
    sunIntensity: 0.2,
    sunElevation: 0,
    sunAzimuth: 180,
    fogEnabled: true,
    fogColor: '#06080f',
    fogNear: 18,
    fogFar: 90,
  });
  store.updateRenderSettings({
    bloomEnabled: true,
    bloomIntensity: 1.2,
    bloomThreshold: 0.4,
    bloomRadius: 0.85,
    vignetteEnabled: true,
  });

  // ============================================================================
  // CINEMATIC — 32s walkthrough. One continuous keyframed camera path threads
  // the corridor + 3 rooms + monolith chamber. Sound beats sync to room arrivals.
  // ============================================================================
  const cinematicId = store.createCinematic('Feather Engine Walkthrough', DURATION);
  store.updateCinematic(cinematicId, { autoplay: true, skippable: true, duration: DURATION });
  store.setCinematicLook(cinematicId, {
    letterbox: 2.39,
    grade: 'cool',
    gradeIntensity: 0.75,
    grain: 0.08,
    vignette: 0.35,
    motionBlur: 0.4,
    anamorphic: 0.6, // horizontal neon streaks — the signature filmic look for a neon corridor
    chromaticAberration: 0.45, // subtle edge fringing
    lightLeak: 0.14, // faint warm film burn drifting across the frame
    lensDirt: 0.5, // grime on the lens that glows where the neon bloom hits it
  });

  // Open from black.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: 0,
    duration: 1.6,
    label: 'Fade in',
    fadeFrom: 1,
    fadeTo: 0,
    fadeColor: '#020308',
  });

  // ---- AUDIO BEATS ----
  if (musicAsset) {
    store.addCinematicAction(cinematicId, {
      type: 'sound', time: 0,
      label: 'Music: Walkthrough bed',
      soundId: musicAsset.id,
    });
  }
  // Door whoosh plays only ONCE at the first room entry — the music carries the middle
  // transitions so the cinematic doesn't get repetitive.
  if (whooshAsset) {
    store.addCinematicAction(cinematicId, {
      type: 'sound', time: 4.0,
      label: 'Door whoosh (Room 1)',
      soundId: whooshAsset.id,
    });
  }
  // A distinct mystical portal swell at the chamber entry replaces the repeated door whoosh
  // and signals to the ear that the destination is near.
  if (portalAsset) {
    store.addCinematicAction(cinematicId, {
      type: 'sound', time: 25.4,
      label: 'Portal approach',
      soundId: portalAsset.id,
    });
  }
  if (chimeAsset) {
    store.addCinematicAction(cinematicId, {
      type: 'sound', time: 27.5,
      label: 'Chime: Wordmark arrival',
      soundId: chimeAsset.id,
    });
  }

  // ---- TIMELINE MARKERS ----
  store.addCinematicMarker(cinematicId, { time: 0,    label: 'Entry corridor',     color: '#aeeaff' });
  store.addCinematicMarker(cinematicId, { time: 4,    label: 'Room 1 · LIGHTING',  color: '#ff9a4d' });
  store.addCinematicMarker(cinematicId, { time: 11.5, label: 'Room 2 · MATERIALS', color: '#4dd0ff' });
  store.addCinematicMarker(cinematicId, { time: 19,   label: 'Room 3 · PARTICLES', color: '#c44dff' });
  store.addCinematicMarker(cinematicId, { time: 26,   label: 'Monolith Chamber',   color: '#dcefff' });
  store.addCinematicMarker(cinematicId, { time: 27.5, label: 'Brand reveal',       color: '#ffd86b' });

  // ---- CAMERA PATH — one continuous keyframed track, eye-level dolly down -Z ----
  const Y_EYE = 1.65;
  store.addCinematicAction(cinematicId, {
    type: 'camera',
    time: 0,
    duration: DURATION,
    label: 'Walkthrough dolly',
    interpolation: 'smooth',
    keyframes: [
      // Entry corridor.
      { time: 0,    position: [0,  Y_EYE,  5],   lookAt: [0, Y_EYE, -10], fov: 50 },
      { time: 2,    position: [0,  Y_EYE,  1],   lookAt: [0, Y_EYE, -10], fov: 50 },
      // Step into Room 1, glance left at the lamps.
      { time: 4.0,  position: [0,  Y_EYE, -8],   lookAt: [-3, 2.5, -14],  fov: 52 },
      { time: 6.5,  position: [0,  Y_EYE, -13],  lookAt: [3,  2.5, -14],  fov: 52 },
      { time: 9.0,  position: [0,  Y_EYE, -18],  lookAt: [-3, 2.5, -18],  fov: 52 },
      // Transition into Room 2.
      { time: 11.5, position: [0,  Y_EYE, -26],  lookAt: [0,  Y_EYE, -36], fov: 50 },
      // Walk past the material spheres, look at them.
      { time: 13.5, position: [0,  Y_EYE, -30],  lookAt: [0,  1.4, -33],   fov: 42, aperture: 4, focusDistance: 3.5 },
      { time: 15.5, position: [0,  Y_EYE, -34],  lookAt: [0,  1.4, -36],   fov: 38, aperture: 4, focusDistance: 2.5 },
      { time: 17.5, position: [0,  Y_EYE, -39],  lookAt: [0,  1.4, -39],   fov: 42, aperture: 4, focusDistance: 1.5 },
      // Transition into Room 3 — slight downward tilt to catch the particles.
      { time: 19.5, position: [0,  Y_EYE, -50],  lookAt: [0,  1.6, -58],   fov: 50 },
      { time: 21.5, position: [0,  Y_EYE, -55],  lookAt: [-3, 2.5, -58],   fov: 48 },
      { time: 23.5, position: [0,  Y_EYE, -61],  lookAt: [3,  3.0, -60],   fov: 48 },
      // Approach the monolith chamber — eye level rises slowly as the wordmark comes into view.
      { time: 26.0, position: [0,  2.0,   -70],  lookAt: [0,  6.0,  MONOLITH_Z], fov: 46 },
      { time: 28.0, position: [0,  2.6,   -78],  lookAt: [0,  9.0,  MONOLITH_Z], fov: 42, aperture: 4.5, focusDistance: 8 },
      // Hero shot of the wordmark + monolith.
      { time: 30.0, position: [0,  3.2,   -80],  lookAt: [0,  8.8,  MONOLITH_Z], fov: 40, aperture: 4.5, focusDistance: 10 },
      // Final gentle crane up.
      { time: 32.0, position: [0,  4.5,   -78],  lookAt: [0,  8.5,  MONOLITH_Z], fov: 44, aperture: 4.5, focusDistance: 9 },
    ],
  });

  // ---- WORDMARK CONTINUOUS BREATH + SLOW YAW ----
  // The wordmark is visible from the start but tiny in frame until the final approach. A slow
  // continuous yaw + a gentle emissive breath keep it alive when the camera arrives.
  store.addCinematicAction(cinematicId, {
    type: 'transform',
    time: 0,
    duration: DURATION,
    label: 'Logo slow yaw',
    objectId: logoEmptyId,
    transformKeyframes: [
      { time: 0,        position: [0, 0, MONOLITH_Z], rotation: [0, -0.18, 0], scale: [1, 1, 1] },
      { time: 16,       position: [0, 0, MONOLITH_Z], rotation: [0,  0.0,  0], scale: [1, 1, 1] },
      { time: DURATION, position: [0, 0, MONOLITH_Z], rotation: [0,  0.12, 0], scale: [1, 1, 1] },
    ],
  });

  // ---- NEON FLICKER REVEAL ----
  // The wordmark + halos are completely UNLIT until t=27.0. Then they fire up like a real
  // neon sign: a rapid stuttering on/off (stepped via interpolation:'hold') for half a second,
  // then a smooth ramp into a steady bright glow. Two material tracks per cube — the first
  // does the stepped flicker, the second smoothly settles into the brand-bright neon.
  //
  // Each wordmark letter has a tiny random phase offset so not every stroke fires at exactly
  // the same instant — that asymmetry sells the "real sign" feel.
  wordmarkIds.forEach((id, index) => {
    const o = (index % 7) * 0.012; // 0–72ms desync per stroke
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.0 + o,
      duration: 0.55,
      label: 'Wordmark neon flicker',
      objectId: id,
      interpolation: 'hold',
      materialKeyframes: [
        { time: 27.00 + o, emissiveColor: '#0a1424', emissiveIntensity: 0   },
        { time: 27.05 + o, emissiveColor: '#aeeaff', emissiveIntensity: 11  },
        { time: 27.11 + o, emissiveColor: '#0a1424', emissiveIntensity: 0   },
        { time: 27.20 + o, emissiveColor: '#aeeaff', emissiveIntensity: 8   },
        { time: 27.26 + o, emissiveColor: '#0a1424', emissiveIntensity: 0   },
        { time: 27.36 + o, emissiveColor: '#aeeaff', emissiveIntensity: 5   },
        { time: 27.42 + o, emissiveColor: '#0a1424', emissiveIntensity: 0   },
        { time: 27.50 + o, emissiveColor: '#aeeaff', emissiveIntensity: 6   },
      ],
    });
    // Smooth settle into the final steady neon glow (overrides the flicker after t=27.55).
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

  // Halos do the same flicker but slightly delayed so the letters strike first and the halo
  // backlight blooms in behind them.
  [haloTopId, haloBottomId].forEach((id) => {
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.15,
      duration: 0.5,
      label: 'Halo neon flicker',
      objectId: id,
      interpolation: 'hold',
      materialKeyframes: [
        { time: 27.15, emissiveColor: '#0a1424', emissiveIntensity: 0 },
        { time: 27.22, emissiveColor: '#aeeaff', emissiveIntensity: 6 },
        { time: 27.28, emissiveColor: '#0a1424', emissiveIntensity: 0 },
        { time: 27.38, emissiveColor: '#aeeaff', emissiveIntensity: 3 },
        { time: 27.44, emissiveColor: '#0a1424', emissiveIntensity: 0 },
        { time: 27.55, emissiveColor: '#aeeaff', emissiveIntensity: 4 },
      ],
    });
    store.addCinematicAction(cinematicId, {
      type: 'material',
      time: 27.6,
      duration: DURATION - 27.6,
      label: 'Halo neon on',
      objectId: id,
      interpolation: 'smooth',
      materialKeyframes: [
        { time: 27.60, emissiveColor: '#aeeaff', emissiveIntensity: 4 },
        { time: 28.40, emissiveColor: '#ffffff', emissiveIntensity: 8 },
        { time: 29.60, emissiveColor: '#aeeaff', emissiveIntensity: 6 },
        { time: DURATION, emissiveColor: '#aeeaff', emissiveIntensity: 6 },
      ],
    });
  });

  // Inscription on the monolith ramps from its dim base glow to brand-bright, synced with
  // the wordmark settle — the whole sign lights up together.
  store.addCinematicAction(cinematicId, {
    type: 'material',
    time: 27.5,
    duration: 1.5,
    label: 'Inscription ignite',
    objectId: inscriptionId,
    materialKeyframes: [
      { time: 27.5, emissiveColor: '#3ad6ff', emissiveIntensity: 1.2 },
      { time: 28.3, emissiveColor: '#aeeaff', emissiveIntensity: 7   },
      { time: 29.0, emissiveColor: '#3ad6ff', emissiveIntensity: 5.5 },
    ],
  });

  // Close to black + final event.
  store.addCinematicAction(cinematicId, {
    type: 'fade',
    time: DURATION - 1.5,
    duration: 1.5,
    label: 'Fade out',
    fadeFrom: 0,
    fadeTo: 1,
    fadeColor: '#020308',
  });
  store.addCinematicAction(cinematicId, {
    type: 'event',
    time: DURATION - 0.25,
    label: 'Fire cinematic_finished',
    eventName: 'cinematic_finished',
  });

  store.setActiveCinematic(cinematicId);
  store.selectObject(logoEmptyId);
  return cinematicId;
}
