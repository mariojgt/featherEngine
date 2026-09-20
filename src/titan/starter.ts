import type { SceneObject, Vector3Tuple } from '../types';
import { defaultSceneEnvironment } from '../three/environmentSettings';
import { pixelTreeSpec, DEFAULT_PIXEL_TREE_RECIPE } from '../extensions/pixelArtTrees/presets';
import { defaultTitanSettings, TITAN_SCENE_MARKER, TITAN_SETTINGS } from './settings';

/** Pure package authoring: ordinary editable scenery, with no installed-editor-plugin dependency. */
export function emberMeadowContent() {
  const objects: SceneObject[] = [];
  let counter = 0;
  const prop = (name: string, kind: 'cube' | 'sphere' | 'empty', position: Vector3Tuple, scale: Vector3Tuple, color: string, rotation: Vector3Tuple = [0, 0, 0]) => {
    const object: SceneObject = { id: `ember-prop-${++counter}`, name, kind, transform: { position, scale, rotation },
      ...(kind === 'empty' ? {} : { renderer: { enabled: true, mesh: kind, color, metalness: 0, roughness: .9 } }) };
    objects.push(object); return object;
  };
  prop(TITAN_SCENE_MARKER, 'empty', [0, 0, 0], [1, 1, 1], '#fff');
  prop('The Sunlit Reach · editable ground', 'cube', [0, -.5, -5], [66, 1, 64], '#68866a');
  prop('Village square', 'cube', [0, .015, 1], [13, .08, 11], '#a2a17c');
  // Keep overlapping paving above the square and at distinct heights to avoid depth flicker.
  for (let i = 0; i < 12; i++) prop('Old meadow trail', 'cube', [Math.sin(i * .65) * 1.8, .085 + i * .002, 4 - i * 2.5], [3.5, .08, 2.6], i % 2 ? '#aca480' : '#b3aa87', [0, Math.sin(i) * .12, 0]);
  for (const x of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      prop('Village border stone', 'cube', [x * 6.3, .35, -3 + i * 2.6], [.65, .7, 1.4], '#7a8b79', [0, i * .15, 0]);
    }
  }
  for (const [x, z, size] of [[-12, 2, 1], [11, 4, .85], [-13, -6, .8]] as const) {
    prop('Meadow cottage · walls', 'cube', [x, 1.5 * size, z], [4.4 * size, 3 * size, 4 * size], '#d0b992');
    prop('Meadow cottage · roof west', 'cube', [x - 1.15 * size, 3.4 * size, z], [3 * size, .3 * size, 4.7 * size], '#587f79', [0, 0, .6]);
    prop('Meadow cottage · roof east', 'cube', [x + 1.15 * size, 3.4 * size, z], [3 * size, .3 * size, 4.7 * size], '#52756d', [0, 0, -.6]);
    prop('Cottage door', 'cube', [x, 1.0 * size, z + 2.02 * size], [1.1 * size, 2 * size, .12], '#50644d');
    prop('Warm window', 'cube', [x + 1.4 * size, 1.8 * size, z + 2.04 * size], [.55 * size, .6 * size, .1], '#e6c57d');
    prop('Stone chimney', 'cube', [x + 1.2 * size, 3.8 * size, z - .8], [.6, 1.8, .6], '#879584');
  }
  for (const x of [-3.2, 3.2]) {
    prop('Beacon gateway pillar', 'cube', [x, 2, -5], [.7, 4, .8], '#bcc2a4');
    prop('Gateway capital', 'cube', [x, 4, -5], [1, .3, 1.1], '#d2cfac');
  }
  prop('Beacon gateway lintel', 'cube', [0, 4.35, -5], [7.2, .55, .9], '#aeba9d');
  prop('The village beacon', 'sphere', [0, 4.8, -5], [.55, .55, .55], '#edce72');
  const tree = pixelTreeSpec({ ...DEFAULT_PIXEL_TREE_RECIPE, scale: .75, leafDensity: .6 }, 'ember-tree', 'Meadow woodland');
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? -1 : 1;
    const x = side * (11 + (i * 7 % 9)); const z = 7 - Math.floor(i / 2) * 2.7;
    const entry = prop('Meadow woodland · Pixel Art Trees', 'empty', [x, 0, z], [1, 1, 1], '#fff');
    entry.tree = { enabled: true, spec: tree, seed: 31 + i * 7 };
  }
  for (let i = 0; i < 32; i++) {
    const x = Math.sin(i * 7.91) * 21; const z = -8 + Math.cos(i * 3.13) * 17;
    if (Math.abs(x) < 4 || (Math.abs(x) > 9 && z > -8)) continue;
    prop('Wildflower patch', 'sphere', [x, .2, z], [.5, .45, .5], i % 3 === 0 ? '#e2c985' : i % 3 === 1 ? '#a6bccc' : '#d4b4a6');
  }
  for (let i = 0; i < 10; i++) prop('Boundary boulder', 'sphere', [-24 + i * 5.2, 1, -27], [3 + i % 2, 2.3, 2.8], '#839787', [0, i, 0]);
  return {
    scenes: [{ id: 'scene-ember-meadow', name: 'Ember Meadow', objects, environment: { ...defaultSceneEnvironment(),
      skyTopColor: '#76aead', skyHorizonColor: '#e3d4a6', skyGroundColor: '#5c7a6b', sunColor: '#ffedc6', sunIntensity: 2,
      sunAzimuth: 140, sunElevation: 40, fogColor: '#bac7a8', fogNear: 35, fogFar: 85, contactShadows: false,
      ambientMode: 'hemisphere' as const, environmentIntensity: .8 } }],
    treeSpecs: [tree],
    variables: (Object.keys(TITAN_SETTINGS) as (keyof typeof TITAN_SETTINGS)[]).map(key => ({ id: `ember-${key}`, name: TITAN_SETTINGS[key], type: 'string' as const, defaultValue: defaultTitanSettings[key], persistent: false, createdAt: 1767225600000 })),
  };
}
