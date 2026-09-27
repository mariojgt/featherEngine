import type { Scene, TreeSpec } from '../types';
import { starterScenery, titanSettingsVariables, emberMeadowEnvironment } from './starter';
import { TITAN_SCENE_MARKER, TITAN_ZONE_MARKER } from './settings';
import { withTerrainDefaults } from '../terrain/terrain';
import { pixelTreeSpec } from '../extensions/pixelArtTrees/presets';
import { VALLEY_HEIGHTS, VALLEY_ID, VALLEY_SIZE, GRID_SPACING, VALLEY_SOLIDS, groundHeight } from '../../examples/titan-mmo/server/valley.mjs';

/** One continuous landscape. Solid props and terrain samples share the server's source of truth. */
export function sunlitReachContent(): { scenes: Scene[]; treeSpecs: TreeSpec[]; variables: ReturnType<typeof titanSettingsVariables> } {
  const { objects, prop } = starterScenery('sunlit-vale-');
  prop(TITAN_SCENE_MARKER, 'empty', [0, 0, 0], [1, 1, 1], '#fff');
  prop(`${TITAN_ZONE_MARKER}${VALLEY_ID}`, 'empty', [0, 0, 0], [1, 1, 1], '#fff');
  const terrain = prop('Sunlit Vale · shared realm terrain', 'terrain', [0, 0, 0], [1, 1, 1], '#59734b');
  terrain.terrain = withTerrainDefaults({ size: VALLEY_SIZE, chunkSize: 32, resolution: 16, streamRadius: 4, physicsRadius: 2,
    heightScale: 4, editSpacing: GRID_SPACING, heightOverrides: { ...VALLEY_HEIGHTS }, materialDistribution: 'ground',
    lowColor: '#5a7848', midColor: '#8a805b', highColor: '#87897c',
    foliage: { ...withTerrainDefaults().foliage, enabled: false } });
  const oak = pixelTreeSpec({ speciesId: 'oak', habit: 'spread', scale: 1, leafDensity: .65, leafInner: '#315d3f', leafOuter: '#789454' }, 'sunlit-vale-oak', 'Vale oak');
  const pine = pixelTreeSpec({ speciesId: 'pine', habit: 'candelabra', scale: 1.1, leafDensity: .7, leafInner: '#214735', leafOuter: '#517849' }, 'sunlit-vale-pine', 'Thornwood pine');
  for (const solid of VALLEY_SOLIDS) {
    const { x, z, width, depth, height } = solid;
    const y = groundHeight(VALLEY_ID, x, z);
    if (solid.kind === 'tree') {
      const tree = prop(`Realm solid · ${solid.id}`, 'empty', [x, y, z], [1, 1, 1], '#fff');
      tree.tree = { enabled: true, spec: z < 0 ? pine : oak, seed: 37 + objects.length * 7, tintJitter: .2 };
      continue;
    }
    prop(`Realm solid · ${solid.id}`, 'cube', [x, y + height / 2, z], [width, height, depth], solid.kind === 'cottage' ? '#c9b38a' : '#777e70');
    if (solid.kind === 'cottage') {
      for (const side of [-1, 1]) prop('Cottage roof', 'cube', [x + side * 1.9, y + height + 1, z], [4.7, .3, depth + .8], '#496a66', [0, 0, side * -.55]);
      prop('Cottage door', 'cube', [x, y + 1.1, z + depth / 2 + .03], [1.4, 2.2, .08], '#4e4435');
      for (const side of [-1, 1]) prop('Cottage window', 'cube', [x + side * 2.1, y + 2.4, z + depth / 2 + .06], [1, 1.1, .1], '#edce88');
    }
    if (solid.kind === 'ruin') prop('Ruined capital', 'cube', [x, y + height + .3, z], [width + .7, .6, depth + .7], '#979383');
  }
  // A continuous north road connects all three quest givers without loading another scene.
  for (let z = -82; z <= 78; z += 2) {
    const back = groundHeight(VALLEY_ID, 0, z - 1), front = groundHeight(VALLEY_ID, 0, z + 1);
    prop('The old north road', 'cube', [0, (back + front) / 2 + .055, z], [4, .08, Math.hypot(2, front - back) + .04], z < -46 ? '#86796a' : '#a29874', [-Math.atan2(front - back, 2), 0, 0]);
  }
  prop('Village square', 'cube', [0, .025, 61], [18, .05, 16], '#a49e7a');
  for (const side of [-1, 1]) {
    prop('Beacon capital', 'cube', [side * 5, 6.1, 46], [1.5, .4, 1.5], '#d3ccb0');
  }
  prop('Beacon arch', 'cube', [0, 6.5, 46], [11, .6, .9], '#b4bb9c');
  const beacon = prop('The Sunlit beacon', 'sphere', [0, 7.3, 46], [.8, .8, .8], '#f0cb79');
  beacon.renderer!.materialOverrides = { emissiveColor: '#edb759', emissiveIntensity: 2 };
  const environment = { ...emberMeadowEnvironment(), fogNear: 75, fogFar: 190, sunElevation: 32 };
  return { scenes: [{ id: 'scene-sunlit-valley', name: 'Sunlit Vale', objects, environment,
    cinematics: [{ id: 'sunlit-vale-vista', name: 'Sunlit Vale · Arrival', duration: 18, frameRate: 24, autoplay: true, skippable: true,
      look: { grade: 'warm', gradeIntensity: .4, vignette: .15 }, createdAt: 1767225600000,
      actions: [{ id: 'vale-camera', type: 'camera', time: 0, duration: 18, interpolation: 'smooth', keyframes: [
        { time: 0, position: [-30, 22, 82], lookAt: [0, 2, 55], fov: 52 },
        { time: 6, position: [18, 16, 42], lookAt: [0, 2, 20], fov: 52 },
        { time: 12, position: [-18, 20, -5], lookAt: [0, 3, -55], fov: 52 },
        { time: 18, position: [10, 9, 72], lookAt: [0, 2, 59], fov: 45 },
      ] }] }],
  }], treeSpecs: [oak, pine], variables: titanSettingsVariables('sunlit-') };
}
