import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { MaterialDefinition, ParticleSystemComponent, SceneObjectKind, Vector3Tuple } from '../types';

type PrimitiveKind = Extract<SceneObjectKind, 'cube' | 'sphere' | 'capsule'>;

interface PartOptions {
  kind: PrimitiveKind;
  name: string;
  position: Vector3Tuple;
  scale: Vector3Tuple;
  materialId: string;
  rotation?: Vector3Tuple;
  parentId?: string;
  solid?: boolean;
  trigger?: boolean;
  hidden?: boolean;
}

interface EmitterOptions {
  name: string;
  position: Vector3Tuple;
  parentId?: string;
  preset: 'dust' | 'magic' | 'sparks';
  patch: Partial<ParticleSystemComponent>;
}

/**
 * Build Cloudstep Garden, an asset-free 3D platformer starter made entirely from editable primitives.
 *
 * The controller and gameplay stay on invisible/simple roots while the character, enemies, islands and
 * goal are assembled from child cubes, spheres and capsules. That separation is deliberate: creators can
 * restyle every body part without disturbing collision, input, triggers or reusable behaviour Blueprints.
 */
export async function createPlatformerTemplate(): Promise<string> {
  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;

  // Safe in the unsaved welcome scene and a freshly-created project; never erase authored work.
  for (const defaultId of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === defaultId)) {
      store.deleteObject(defaultId);
    }
  }

  store.renameScene(sceneId, 'Cloudstep Garden');
  store.applyRenderPreset(sceneId, 'vibrant-arcade');
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural',
    backgroundColor: '#77DDF4',
    skyTopColor: '#5BC9F1',
    skyHorizonColor: '#CFF7E8',
    skyGroundColor: '#9BE4E1',
    environmentIntensity: 1.18,
    sunColor: '#FFF2BF',
    sunIntensity: 1.55,
    sunAzimuth: 32,
    sunElevation: 46,
    fogEnabled: true,
    fogColor: '#B6EEE8',
    fogNear: 70,
    fogFar: 165,
    atmosphericFog: true,
    aerialFogEnabled: true,
    aerialFogHeightFalloff: 0.018,
    aerialFogSunColor: '#FFE7A8',
    aerialFogInscatter: 0.18,
    aerialFogInscatterPower: 5,
    wind: [1.2, 0, 0.5],
    windTurbulence: 0.25,
    toneMapping: 'agx',
    toneMappingExposure: 1.06,
    ambientMode: 'hemisphere',
    contactShadows: true,
    contactShadowY: 0,
    contactShadowScale: 24,
    contactShadowOpacity: 0.28,
    contactShadowBlur: 3.1,
    contactShadowFar: 9,
    contactShadowColor: '#24556C',
  });
  store.updateRenderSettings({
    quality: 'High',
    autoQuality: true,
    bloomEnabled: true,
    bloomIntensity: 0.5,
    bloomThreshold: 0.76,
    bloomRadius: 0.48,
    vignetteEnabled: true,
  });

  const materialFolder = store.createFolder('Cloudstep Materials');
  const logicFolder = store.createFolder('Cloudstep Logic');
  const characterFolder = store.createFolder('Cloudstep Characters');
  const uiFolder = store.createFolder('Cloudstep UI');

  const material = (name: string, description: string, patch: Partial<MaterialDefinition>): string => {
    const id = store.createMaterial(name, description, materialFolder);
    store.updateMaterial(id, {
      color: '#FFFFFF',
      metalness: 0,
      roughness: 1,
      emissiveColor: '#000000',
      emissiveIntensity: 0,
      toon: true,
      toonFinish: 'jelly',
      toonBands: 3,
      toonRimColor: '#F4FDFF',
      toonRimStrength: 0.16,
      ...patch,
    });
    return id;
  };

  const mats = {
    grass: material('Mint Jelly Grass', 'Fresh mint candy turf for the playable route.', {
      color: '#68DA78',
      emissiveColor: '#68DA78',
      emissiveIntensity: 0.025,
    }),
    soil: material('Blueberry Island', 'Cool matte island undersides that separate cleanly from the sky.', {
      color: '#315A78',
      toonFinish: 'rubber',
      toonRimColor: '#8DDCE8',
      toonRimStrength: 0.13,
    }),
    cream: material('Cloud Pearl', 'Warm pearl-white clouds, trim and friendly highlights.', {
      color: '#FFF7DD',
      emissiveColor: '#FFFFFF',
      emissiveIntensity: 0.12,
      toonFinish: 'pearl',
      toonRimColor: '#FFFFFF',
      toonRimStrength: 0.2,
    }),
    coral: material('Pip Coral', 'The hero colour: warm, joyful and readable against the sky.', {
      color: '#FF6F91',
      emissiveColor: '#FF6F91',
      emissiveIntensity: 0.035,
      toonRimColor: '#FFE9F0',
      toonRimStrength: 0.2,
    }),
    teal: material('Sky Teal', 'Cool secondary colour for Pip, movers and route accents.', {
      color: '#39D7C5',
      emissiveColor: '#39D7C5',
      emissiveIntensity: 0.04,
      toonRimColor: '#DFFFF9',
      toonRimStrength: 0.22,
    }),
    gold: material('Sun Seed Gold', 'Bright collectible gold tuned to catch the bloom pass.', {
      color: '#FFD84F',
      emissiveColor: '#FFB82E',
      emissiveIntensity: 0.55,
      toonFinish: 'pearl',
      toonRimColor: '#FFF8D2',
      toonRimStrength: 0.24,
    }),
    violet: material('Grumble Violet', 'Playful rival colour for the garden critters.', {
      color: '#8C72FF',
      emissiveColor: '#8C72FF',
      emissiveIntensity: 0.035,
      toonRimColor: '#EEE9FF',
      toonRimStrength: 0.2,
    }),
    ink: material('Soft Ink', 'Near-black rubber for eyes, soles and graphic details.', {
      color: '#18314A',
      toonFinish: 'rubber',
      toonRimColor: '#6BB2C4',
      toonRimStrength: 0.08,
    }),
    leaf: material('Leaf Pop', 'Lush saturated green for sprout leaves and flowers.', {
      color: '#25B96B',
      emissiveColor: '#25B96B',
      emissiveIntensity: 0.02,
      toonFinish: 'cloth',
      toonRimColor: '#CFFFE4',
      toonRimStrength: 0.14,
    }),
  };

  const addPart = ({
    kind,
    name,
    position,
    scale,
    materialId,
    rotation = [0, 0, 0],
    parentId,
    solid = false,
    trigger = false,
    hidden = false,
  }: PartOptions): string => {
    const id = store.createObjectWithProps(kind, {
      name,
      position,
      parentId,
      physics:
        solid || trigger
          ? {
              enabled: true,
              bodyType: 'fixed',
              collider: kind === 'sphere' ? 'sphere' : kind === 'capsule' ? 'capsule' : 'box',
              isTrigger: trigger,
              friction: 0.92,
              restitution: 0.04,
            }
          : undefined,
    });
    store.updateTransform(id, 'rotation', rotation);
    store.updateTransform(id, 'scale', scale);
    store.setObjectMaterial(id, materialId);
    if (hidden) store.updateRenderer(id, { enabled: false });
    return id;
  };

  const addEmitter = ({ name, position, parentId, preset, patch }: EmitterOptions): string => {
    const id = store.createObjectWithProps('empty', { name, position, parentId });
    store.addParticles(id, preset);
    store.updateParticles(id, patch);
    return id;
  };

  const compile = (name: string, description: string, source: string): string => {
    const { blueprintId } = store.createBlueprintNamed(name, description, logicFolder);
    const result = store.applyBlueprintFeatherSource(blueprintId, source);
    if (!result.ok) {
      throw new Error(
        `Could not compile ${name}: ${result.diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`,
      );
    }
    return blueprintId;
  };

  // Empty objects otherwise inherit the editor's generic Y=2 spawn default. Organizational roots must
  // be true zero transforms or their nested render meshes and physics colliders silently inherit offsets.
  const worldRoot = store.createObjectWithProps('empty', {
    name: 'Cloudstep Garden — World',
    position: [0, 0, 0],
  });
  const courseRoot = store.createObjectWithProps('empty', {
    name: '01 — Playable Course',
    position: [0, 0, 0],
    parentId: worldRoot,
  });
  const sceneryRoot = store.createObjectWithProps('empty', {
    name: '02 — Sky Scenery',
    position: [0, 0, 0],
    parentId: worldRoot,
  });
  const vfxRoot = store.createObjectWithProps('empty', {
    name: '03 — Cartoon VFX',
    position: [0, 0, 0],
    parentId: worldRoot,
  });

  const addIsland = (
    name: string,
    position: Vector3Tuple,
    width: number,
    depth: number,
    decorateUnderside = true,
  ): string => {
    const root = store.createObjectWithProps('empty', { name, position, parentId: courseRoot });
    addPart({
      kind: 'cube',
      name: `${name} — Turf Collider`,
      position: [0, -0.18, 0],
      scale: [width, 0.36, depth],
      materialId: mats.grass,
      parentId: root,
      solid: true,
    });
    if (decorateUnderside) {
      addPart({
        kind: 'cube',
        name: `${name} — Blueberry Core`,
        position: [0, -0.9, 0],
        scale: [width * 0.86, 1.12, depth * 0.84],
        materialId: mats.soil,
        parentId: root,
      });
      for (const [index, x] of [-0.28, 0, 0.28].entries()) {
        addPart({
          kind: 'sphere',
          name: `${name} — Floating Rock ${index + 1}`,
          position: [width * x, -1.72 - (index % 2) * 0.18, depth * (index === 1 ? 0.08 : -0.12)],
          scale: [width * 0.24, 1.22 + index * 0.08, depth * 0.22],
          materialId: mats.soil,
          parentId: root,
        });
      }
    }
    return root;
  };

  const addStep = (name: string, x: number, topY: number, z: number, width = 4, depth = 3): string => {
    const id = addPart({
      kind: 'cube',
      name,
      position: [x, topY - 0.25, z],
      scale: [width, 0.5, depth],
      materialId: mats.grass,
      parentId: courseRoot,
      solid: true,
    });
    addPart({
      kind: 'sphere',
      name: `${name} — Cloud Cushion`,
      position: [x, topY - 0.78, z],
      scale: [width * 0.68, 0.8, depth * 0.72],
      materialId: mats.cream,
      parentId: sceneryRoot,
    });
    return id;
  };

  // Pull the start island behind Pip so the resting follow camera sits above its turf instead of
  // outside the near edge looking across the blueberry underside.
  const startIsland = addIsland('Start Island', [0, 0, -3], 12, 18, false);
  addPart({
    kind: 'cube',
    name: 'Start Island — Blueberry Underside',
    position: [0, -0.74, 0],
    scale: [10.7, 0.92, 15.8],
    materialId: mats.soil,
    parentId: startIsland,
  });
  [
    [-3.8, -1.2, -4.8, 2.7, 1.05, 3.2, mats.cream],
    [0, -1.42, -2.1, 3.4, 1.28, 3.8, mats.soil],
    [3.9, -1.16, -0.3, 2.8, 1.02, 3.1, mats.cream],
    [-3.1, -1.3, 4.6, 2.5, 1.1, 2.8, mats.soil],
    [2.1, -1.48, 5.4, 3.1, 1.3, 3.2, mats.cream],
  ].forEach(([x, y, z, sx, sy, sz, materialId], index) => {
    addPart({
      kind: 'sphere',
      name: `Start Island — Floating Lobe ${index + 1}`,
      position: [x as number, y as number, z as number],
      scale: [sx as number, sy as number, sz as number],
      materialId: materialId as string,
      parentId: startIsland,
    });
  });
  addStep('Mint Step 01', -2.8, 0.65, 9, 4.2, 3.2);
  addStep('Mint Step 02', 2.4, 1.1, 14, 4.1, 3.1);

  const mover = store.createRoleObject('moving-platform', {
    kind: 'cube',
    name: 'Teal Cloud Ferry',
    position: [-3, 1.37, 19],
    color: '#39D7C5',
    parentId: courseRoot,
  });
  if (!mover.ok || !mover.objectId) throw new Error('Could not create the moving cloud ferry.');
  store.updateTransform(mover.objectId, 'scale', [4.6, 0.56, 3.1]);
  store.setObjectMaterial(mover.objectId, mats.teal);
  store.setObjectVariable(mover.objectId, 'speed', 1.65);
  store.setObjectVariable(mover.objectId, 'distance', 6);
  addEmitter({
    name: 'Teal Cloud Ferry — Cream Wake',
    position: [0, -0.18, -0.9],
    parentId: mover.objectId,
    preset: 'dust',
    patch: {
      enabled: true,
      looping: true,
      rate: 9,
      burst: 0,
      maxParticles: 36,
      shape: 'disc',
      shapeRadius: 0.7,
      speed: 0.25,
      speedJitter: 0.7,
      direction: [0, 0.35, -1],
      gravity: -0.08,
      drag: 0.42,
      lifetime: 0.8,
      lifetimeJitter: 0.24,
      startSize: 0.25,
      endSize: 0.9,
      startColor: '#FFF7DD',
      endColor: '#8FF1D5',
      startOpacity: 0.34,
      endOpacity: 0,
      worldSpace: true,
      blend: 'normal',
      light: false,
    },
  });

  addStep('Landing Puff', 2.8, 0.9, 23, 4.2, 3.1);
  addIsland('Sky Garden Island', [0, 0.15, 30], 14, 11);
  addStep('High Cloud 01', 0, 1.65, 38, 4.4, 3.1);
  addStep('High Cloud 02', -3, 2.9, 42, 4, 3.1);
  addStep('High Cloud 03', 3, 4.0, 46, 4, 3.1);
  addIsland('Sun Crown Island', [0, 4.5, 54], 12, 11);

  // A real character controller on an invisible root, with a readable toy character as child parts.
  const player = store.createRoleObject('player', {
    kind: 'empty',
    name: 'Pip — Player Controller',
    // Author the reusable character at a clean prefab origin. Its linked scene instance receives the
    // safe above-turf spawn override after capture, so every additional Pip starts from a neutral asset.
    position: [0, 0, 0],
  });
  if (!player.ok || !player.objectId) throw new Error('Could not create Pip.');
  const playerId = player.objectId;
  store.updateCharacterController(playerId, {
    autoInputWithScript: true,
    moveSpeed: 5.2,
    sprintMultiplier: 1.38,
    jumpStrength: 9.4,
    gravity: 20,
    fallMultiplier: 2.15,
    jumpCutMultiplier: 0.5,
    coyoteTime: 0.16,
    jumpBufferTime: 0.18,
    landingRecovery: 0.18,
    apexHang: 0.58,
    acceleration: 72,
    deceleration: 78,
    airControl: 0.56,
    turnSpeed: 14,
    sprintTurnFactor: 0.72,
    slideEnabled: false,
    mantleEnabled: false,
    cameraOffset: [0, 3.25, -8.2],
    cameraPitch: 0.16,
    cameraMinPitch: -0.05,
    cameraMaxPitch: 0.92,
    cameraRelativeMovement: true,
    groundLevel: -20,
    meleeDamage: 35,
    meleeRange: 1.8,
  });

  // Pip uses an authored three-heart loop rather than the engine health pool. A Receive Damage listener
  // without `health` is deliberately notify-only, which leaves the Blueprint alive long enough to play its
  // squash/spin defeat and delayed checkpoint recovery instead of being auto-ragdolled on the lethal hit.
  const pipHeartsId = store.createVariable('PipHearts', 'number', false);
  store.updateVariable(pipHeartsId, { defaultValue: 3 });
  const fallOutId = store.createVariable('FallOut', 'boolean', false);
  store.updateVariable(fallOutId, { defaultValue: false });
  const scoreId = store.createVariable('Score', 'number', true);
  store.updateVariable(scoreId, { defaultValue: 0 });
  const checkpointId = store.createVariable('Checkpoint', 'number', false);
  store.updateVariable(checkpointId, { defaultValue: 0 });
  const levelCompleteId = store.createVariable('LevelComplete', 'boolean', false);
  store.updateVariable(levelCompleteId, { defaultValue: false });
  const pipBoostId = store.createVariable('PipBoost', 'boolean', false);
  store.updateVariable(pipBoostId, { defaultValue: false });

  const pipRig = store.createObjectWithProps('empty', {
    name: 'Pip — Primitive Body Rig',
    position: [0, 0, 0],
    parentId: playerId,
  });
  addPart({ kind: 'capsule', name: 'Pip Torso', position: [0, 0.82, 0], scale: [0.62, 0.68, 0.5], materialId: mats.coral, parentId: pipRig });
  addPart({ kind: 'capsule', name: 'Pip Teal Waist Band', position: [0, 0.57, 0], scale: [0.65, 0.16, 0.52], materialId: mats.teal, parentId: pipRig });
  addPart({ kind: 'sphere', name: 'Pip Cream Belly Patch', position: [0, 0.84, 0.43], scale: [0.36, 0.4, 0.09], materialId: mats.cream, parentId: pipRig });

  // The face is grouped under a real pivot so the eyes, cheeks, mouth and sprout keep their relationships
  // while Pip looks around, recoils and falls. The two-layer mouth makes a clean crescent without textures.
  const pipHeadPivot = store.createObjectWithProps('empty', {
    name: 'Pip — Head Pivot',
    position: [0, 1.43, 0.02],
    parentId: pipRig,
  });
  addPart({ kind: 'sphere', name: 'Pip Head', position: [0, 0, 0], scale: [0.72, 0.66, 0.66], materialId: mats.cream, parentId: pipHeadPivot });
  const pipLeftEyePivot = store.createObjectWithProps('empty', {
    name: 'Pip — Left Eye Blink Pivot',
    position: [-0.2, 0.08, 0.36],
    parentId: pipHeadPivot,
  });
  const pipRightEyePivot = store.createObjectWithProps('empty', {
    name: 'Pip — Right Eye Blink Pivot',
    position: [0.2, 0.08, 0.36],
    parentId: pipHeadPivot,
  });
  addPart({ kind: 'sphere', name: 'Pip Left Eye', position: [0, 0, 0], scale: [0.12, 0.17, 0.1], materialId: mats.ink, parentId: pipLeftEyePivot });
  addPart({ kind: 'sphere', name: 'Pip Right Eye', position: [0, 0, 0], scale: [0.12, 0.17, 0.1], materialId: mats.ink, parentId: pipRightEyePivot });
  addPart({ kind: 'sphere', name: 'Pip Left Eye Glint', position: [0.03, 0.05, 0.07], scale: [0.035, 0.05, 0.025], materialId: mats.cream, parentId: pipLeftEyePivot });
  addPart({ kind: 'sphere', name: 'Pip Right Eye Glint', position: [0.03, 0.05, 0.07], scale: [0.035, 0.05, 0.025], materialId: mats.cream, parentId: pipRightEyePivot });
  addPart({ kind: 'capsule', name: 'Pip Left Brow', position: [-0.21, 0.28, 0.36], scale: [0.045, 0.12, 0.04], rotation: [0, 0, -0.24], materialId: mats.ink, parentId: pipHeadPivot });
  addPart({ kind: 'capsule', name: 'Pip Right Brow', position: [0.21, 0.28, 0.36], scale: [0.045, 0.12, 0.04], rotation: [0, 0, 0.24], materialId: mats.ink, parentId: pipHeadPivot });
  addPart({ kind: 'sphere', name: 'Pip Left Cheek', position: [-0.38, -0.08, 0.3], scale: [0.13, 0.08, 0.055], materialId: mats.coral, parentId: pipHeadPivot });
  addPart({ kind: 'sphere', name: 'Pip Right Cheek', position: [0.38, -0.08, 0.3], scale: [0.13, 0.08, 0.055], materialId: mats.coral, parentId: pipHeadPivot });
  addPart({ kind: 'sphere', name: 'Pip Smile', position: [0, -0.17, 0.35], scale: [0.18, 0.12, 0.055], materialId: mats.ink, parentId: pipHeadPivot });
  addPart({ kind: 'sphere', name: 'Pip Smile Cutout', position: [0, -0.11, 0.39], scale: [0.18, 0.1, 0.045], materialId: mats.cream, parentId: pipHeadPivot });

  const pipSproutPivot = store.createObjectWithProps('empty', {
    name: 'Pip — Sprout Pivot',
    position: [0, 0.5, 0],
    parentId: pipHeadPivot,
  });
  addPart({ kind: 'capsule', name: 'Pip Sprout Stem', position: [0, 0.17, 0], scale: [0.11, 0.28, 0.11], materialId: mats.leaf, parentId: pipSproutPivot });
  addPart({ kind: 'sphere', name: 'Pip Sprout Leaf', position: [0.2, 0.34, 0], scale: [0.35, 0.16, 0.25], rotation: [0, 0, -0.35], materialId: mats.leaf, parentId: pipSproutPivot });

  // Shoulder and hip empties are animation joints. Hands and shoes are children of the matching limb,
  // so even extreme jump/fall poses stay connected instead of sliding away from the body.
  const pipLeftShoulder = store.createObjectWithProps('empty', { name: 'Pip — Left Shoulder Pivot', position: [-0.5, 1.06, 0], parentId: pipRig });
  store.updateTransform(pipLeftShoulder, 'rotation', [0, 0, -0.16]);
  addPart({ kind: 'capsule', name: 'Pip Left Arm', position: [0, -0.28, 0], scale: [0.19, 0.43, 0.19], materialId: mats.teal, parentId: pipLeftShoulder });
  addPart({ kind: 'sphere', name: 'Pip Left Hand', position: [0, -0.57, 0.04], scale: [0.21, 0.21, 0.2], materialId: mats.cream, parentId: pipLeftShoulder });
  const pipRightShoulder = store.createObjectWithProps('empty', { name: 'Pip — Right Shoulder Pivot', position: [0.5, 1.06, 0], parentId: pipRig });
  store.updateTransform(pipRightShoulder, 'rotation', [0, 0, 0.16]);
  addPart({ kind: 'capsule', name: 'Pip Right Arm', position: [0, -0.28, 0], scale: [0.19, 0.43, 0.19], materialId: mats.teal, parentId: pipRightShoulder });
  addPart({ kind: 'sphere', name: 'Pip Right Hand', position: [0, -0.57, 0.04], scale: [0.21, 0.21, 0.2], materialId: mats.cream, parentId: pipRightShoulder });
  const pipLeftHip = store.createObjectWithProps('empty', { name: 'Pip — Left Hip Pivot', position: [-0.23, 0.56, 0], parentId: pipRig });
  store.updateTransform(pipLeftHip, 'rotation', [0, 0, -0.04]);
  addPart({ kind: 'capsule', name: 'Pip Left Leg', position: [0, -0.24, 0], scale: [0.22, 0.36, 0.22], materialId: mats.coral, parentId: pipLeftHip });
  addPart({ kind: 'sphere', name: 'Pip Left Shoe', position: [0, -0.49, 0.15], scale: [0.36, 0.2, 0.48], materialId: mats.ink, parentId: pipLeftHip });
  const pipRightHip = store.createObjectWithProps('empty', { name: 'Pip — Right Hip Pivot', position: [0.23, 0.56, 0], parentId: pipRig });
  store.updateTransform(pipRightHip, 'rotation', [0, 0, 0.04]);
  addPart({ kind: 'capsule', name: 'Pip Right Leg', position: [0, -0.24, 0], scale: [0.22, 0.36, 0.22], materialId: mats.coral, parentId: pipRightHip });
  addPart({ kind: 'sphere', name: 'Pip Right Shoe', position: [0, -0.49, 0.15], scale: [0.36, 0.2, 0.48], materialId: mats.ink, parentId: pipRightHip });

  // The game camera follows from behind, so this scarf knot and twin tails make Pip identifiable in the
  // view players see most often instead of spending all of the character detail on the hidden face.
  const pipScarfPivot = store.createObjectWithProps('empty', {
    name: 'Pip — Scarf Flutter Pivot',
    position: [0, 1.1, -0.43],
    parentId: pipRig,
  });
  addPart({ kind: 'sphere', name: 'Pip Scarf Knot', position: [0, 0, 0], scale: [0.24, 0.2, 0.16], materialId: mats.gold, parentId: pipScarfPivot });
  addPart({ kind: 'capsule', name: 'Pip Left Scarf Tail', position: [-0.14, -0.27, 0], scale: [0.11, 0.33, 0.09], rotation: [0.2, 0, -0.3], materialId: mats.teal, parentId: pipScarfPivot });
  addPart({ kind: 'capsule', name: 'Pip Right Scarf Tail', position: [0.15, -0.3, -0.01], scale: [0.1, 0.29, 0.085], rotation: [-0.18, 0, 0.35], materialId: mats.teal, parentId: pipScarfPivot });

  const bobBlueprint = compile(
    'Pip Idle Bounce',
    'A tiny looping local-space bounce that pauses cleanly during Pip’s authored defeat beat.',
    [
      'blueprint Pip_Idle_Bounce',
      '',
      'var bobbing: boolean = true',
      '',
      'on start:',
      '    timeline_control("pip-bob", command: "play")',
      '',
      'on update(dt):',
      `    if Game.FallOut == true or speed("${playerId}") > 0.55:`,
      '        if self.bobbing == true:',
      '            self.bobbing = false',
      '            timeline_control("pip-bob", command: "stop")',
      '            tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.12)',
      '    else:',
      '        if self.bobbing == false:',
      '            self.bobbing = true',
      '            timeline_control("pip-bob", command: "restart")',
      '',
      'detached:',
      '    timeline(self, id: "pip-bob", name: "Pip Bob", property: "position", to: vec3(0, 0.055, 0), duration: 0.72, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );
  store.attachScript(pipRig, bobBlueprint);

  // Dormant emitters keep frequent motion feedback allocation-free. The player Blueprint wakes them only
  // for a jump, landing or real dash, while autoInputWithScript preserves the tuned built-in controller.
  const pipFootFx = addEmitter({
    name: 'Pip — Cream Cloud Puffs',
    position: [0, 0.08, 0],
    parentId: playerId,
    preset: 'dust',
    patch: {
      enabled: false,
      looping: false,
      rate: 0,
      burst: 0,
      maxParticles: 56,
      shape: 'disc',
      shapeRadius: 0.42,
      speed: 1.7,
      speedJitter: 0.65,
      direction: [0, 1, 0],
      gravity: -0.16,
      drag: 0.72,
      lifetime: 0.42,
      lifetimeJitter: 0.22,
      startSize: 0.28,
      endSize: 0.78,
      startColor: '#FFF8DE',
      endColor: '#8FF1D5',
      startOpacity: 0.95,
      endOpacity: 0,
      worldSpace: true,
      blend: 'normal',
      light: false,
    },
  });
  const pipDashFx = addEmitter({
    name: 'Pip — Coral Dash Streaks',
    position: [0, 0.62, -0.28],
    parentId: playerId,
    preset: 'magic',
    patch: {
      enabled: false,
      looping: true,
      rate: 42,
      burst: 0,
      maxParticles: 72,
      shape: 'cone',
      shapeRadius: 0.22,
      coneAngle: 18,
      speed: 1.9,
      speedJitter: 0.5,
      direction: [0, 0.12, -1],
      gravity: -0.05,
      drag: 0.18,
      lifetime: 0.28,
      lifetimeJitter: 0.28,
      startSize: 0.22,
      endSize: 0.015,
      startColor: '#FF8BA8',
      endColor: '#55F0D3',
      startOpacity: 0.92,
      endOpacity: 0,
      worldSpace: true,
      blend: 'additive',
      light: false,
    },
  });
  const pipAirFx = addEmitter({
    name: 'Pip — Mint Air Beads',
    position: [0, 0.72, -0.25],
    parentId: playerId,
    preset: 'magic',
    patch: {
      enabled: false,
      looping: true,
      rate: 14,
      burst: 0,
      maxParticles: 48,
      shape: 'sphere',
      shapeRadius: 0.24,
      speed: 0.45,
      speedJitter: 0.72,
      direction: [0, 0.16, -1],
      gravity: -0.04,
      drag: 0.24,
      lifetime: 0.62,
      lifetimeJitter: 0.24,
      startSize: 0.12,
      endSize: 0.015,
      startColor: '#CFFFF3',
      endColor: '#FFD84F',
      startOpacity: 0.78,
      endOpacity: 0,
      worldSpace: true,
      blend: 'additive',
      light: false,
    },
  });
  const pipImpactFx = addEmitter({
    name: 'Pip — Gold Impact Flecks',
    position: [0, 0.72, 0],
    parentId: playerId,
    preset: 'sparks',
    patch: {
      enabled: false,
      looping: false,
      rate: 0,
      burst: 0,
      maxParticles: 64,
      shape: 'sphere',
      shapeRadius: 0.22,
      speed: 4.4,
      speedJitter: 0.62,
      direction: [0, 1, 0],
      gravity: 4.8,
      drag: 0.16,
      lifetime: 0.35,
      lifetimeJitter: 0.22,
      startSize: 0.11,
      endSize: 0.01,
      startColor: '#FFF6B5',
      endColor: '#FF789D',
      startOpacity: 1,
      endOpacity: 0,
      worldSpace: true,
      blend: 'additive',
      light: false,
    },
  });
  const pipMotionBlueprint = compile(
    'Pip Cartoon Motion',
    'Articulates Pip’s run, jump, fall, landing, dash, hurt and defeat poses without replacing player input.',
    [
      'blueprint Pip_Cartoon_Motion',
      '',
      'var jump_fx_ready: boolean = true',
      'var run_pose: boolean = false',
      'var airborne_pose: boolean = false',
      'var fall_pose: boolean = false',
      'var dash_held: boolean = false',
      'var dash_active: boolean = false',
      'var landing_lock: boolean = false',
      'var hurt_ready: boolean = true',
      '',
      'on start:',
      `    set_particles("${pipDashFx}", false)`,
      `    set_particles("${pipAirFx}", false)`,
      '    Game.PipBoost = false',
      '    timeline_control("pip-head-tilt", command: "play")',
      '    timeline_control("pip-sprout-flutter", command: "play")',
      '    timeline_control("pip-scarf-flutter", command: "play")',
      '',
      'on update(dt):',
      '    if Game.FallOut == false:',
      '        if self.is_grounded():',
      '            if self.landing_lock == false:',
      '                if speed(self) > 0.55:',
      '                    if self.run_pose == false:',
      '                        self.run_pose = true',
      `                        set_rotation("${pipLeftShoulder}", vec3(-36, 0, -9))`,
      `                        set_rotation("${pipRightShoulder}", vec3(36, 0, 9))`,
      `                        set_rotation("${pipLeftHip}", vec3(28, 0, -2.3))`,
      `                        set_rotation("${pipRightHip}", vec3(-28, 0, 2.3))`,
      '                        timeline_control("pip-left-arm-run", command: "restart")',
      '                        timeline_control("pip-right-arm-run", command: "restart")',
      '                        timeline_control("pip-left-leg-run", command: "restart")',
      '                        timeline_control("pip-right-leg-run", command: "restart")',
      '                else:',
      '                    if self.run_pose == true:',
      '                        self.run_pose = false',
      '                        timeline_control("pip-left-arm-run", command: "stop")',
      '                        timeline_control("pip-right-arm-run", command: "stop")',
      '                        timeline_control("pip-left-leg-run", command: "stop")',
      '                        timeline_control("pip-right-leg-run", command: "stop")',
      `                        tween("${pipLeftShoulder}", property: "rotation", to: vec3(0, 0, -9), duration: 0.14)`,
      `                        tween("${pipRightShoulder}", property: "rotation", to: vec3(0, 0, 9), duration: 0.14)`,
      `                        tween("${pipLeftHip}", property: "rotation", to: vec3(0, 0, -2.3), duration: 0.14)`,
      `                        tween("${pipRightHip}", property: "rotation", to: vec3(0, 0, 2.3), duration: 0.14)`,
      '            if self.dash_held == true:',
      '                if speed(self) > 4:',
      '                    if self.dash_active == false:',
      '                        self.dash_active = true',
      '                        Game.PipBoost = true',
      `                        set_particles("${pipDashFx}", true)`,
      `                        burst_particles("${pipFootFx}", 7)`,
      `                        burst_particles("${pipImpactFx}", 10)`,
      `                        tween("${pipRig}", property: "rotation", to: vec3(7, 0, 0), duration: 0.12)`,
      '                else:',
      '                    if self.dash_active == true:',
      '                        self.dash_active = false',
      '                        Game.PipBoost = false',
      `                        set_particles("${pipDashFx}", false)`,
      `                        tween("${pipRig}", property: "rotation", to: vec3(0, 0, 0), duration: 0.12)`,
      '            else:',
      '                if self.dash_active == true:',
      '                    self.dash_active = false',
      '                    Game.PipBoost = false',
      `                    set_particles("${pipDashFx}", false)`,
      `                    tween("${pipRig}", property: "rotation", to: vec3(0, 0, 0), duration: 0.12)`,
      '        else:',
      '            if self.run_pose == true:',
      '                self.run_pose = false',
      '                timeline_control("pip-left-arm-run", command: "stop")',
      '                timeline_control("pip-right-arm-run", command: "stop")',
      '                timeline_control("pip-left-leg-run", command: "stop")',
      '                timeline_control("pip-right-leg-run", command: "stop")',
      '            if self.dash_active == true:',
      '                self.dash_active = false',
      '                Game.PipBoost = false',
      `                set_particles("${pipDashFx}", false)`,
      `                tween("${pipRig}", property: "rotation", to: vec3(0, 0, 0), duration: 0.12)`,
      '            if self.airborne_pose == false:',
      '                self.airborne_pose = true',
      `                set_particles("${pipAirFx}", true)`,
      `                tween("${pipLeftShoulder}", property: "rotation", to: vec3(-26, 0, -42), duration: 0.12)`,
      `                tween("${pipRightShoulder}", property: "rotation", to: vec3(-26, 0, 42), duration: 0.12)`,
      `                tween("${pipLeftHip}", property: "rotation", to: vec3(28, 0, -6), duration: 0.12)`,
      `                tween("${pipRightHip}", property: "rotation", to: vec3(-12, 0, 6), duration: 0.12)`,
      '            if dot(velocity(self), vec3(0, 1, 0)) < -0.3:',
      '                if self.fall_pose == false:',
      '                    self.fall_pose = true',
      `                    tween("${pipLeftShoulder}", property: "rotation", to: vec3(5, 0, -72), duration: 0.16)`,
      `                    tween("${pipRightShoulder}", property: "rotation", to: vec3(5, 0, 72), duration: 0.16)`,
      `                    tween("${pipLeftHip}", property: "rotation", to: vec3(18, 0, -18), duration: 0.16)`,
      `                    tween("${pipRightHip}", property: "rotation", to: vec3(-22, 0, 18), duration: 0.16)`,
      '',
      'on key_down("Space"):',
      '    if self.jump_fx_ready == true:',
      '        self.jump_fx_ready = false',
      '        self.airborne_pose = true',
      '        self.fall_pose = false',
      '        self.run_pose = false',
      '        timeline_control("pip-left-arm-run", command: "stop")',
      '        timeline_control("pip-right-arm-run", command: "stop")',
      '        timeline_control("pip-left-leg-run", command: "stop")',
      '        timeline_control("pip-right-leg-run", command: "stop")',
      `        set_particles("${pipAirFx}", true)`,
      `        tween("${pipLeftShoulder}", property: "rotation", to: vec3(-26, 0, -42), duration: 0.1)`,
      `        tween("${pipRightShoulder}", property: "rotation", to: vec3(-26, 0, 42), duration: 0.1)`,
      `        tween("${pipLeftHip}", property: "rotation", to: vec3(28, 0, -6), duration: 0.1)`,
      `        tween("${pipRightHip}", property: "rotation", to: vec3(-12, 0, 6), duration: 0.1)`,
      `        burst_particles("${pipFootFx}", 14)`,
      `        burst_particles("${pipImpactFx}", 6)`,
      `        set_scale("${pipRig}", vec3(1.12, 0.82, 1.12))`,
      '        wait(0.04)',
      `        set_scale("${pipRig}", vec3(0.86, 1.17, 0.86))`,
      `        tween("${pipRig}", property: "scale", to: vec3(1, 1, 1), duration: 0.14)`,
      '',
      'on key_down("ShiftLeft"):',
      '    self.dash_held = true',
      '',
      'on key_up("ShiftLeft"):',
      '    self.dash_held = false',
      '    self.dash_active = false',
      '    Game.PipBoost = false',
      `    set_particles("${pipDashFx}", false)`,
      `    tween("${pipRig}", property: "rotation", to: vec3(0, 0, 0), duration: 0.12)`,
      '',
      'on land:',
      '    self.jump_fx_ready = true',
      '    self.airborne_pose = false',
      '    self.fall_pose = false',
      '    self.landing_lock = true',
      '    self.dash_active = false',
      '    Game.PipBoost = false',
      `    set_particles("${pipDashFx}", false)`,
      `    set_particles("${pipAirFx}", false)`,
      `    burst_particles("${pipFootFx}", 28)`,
      `    burst_particles("${pipImpactFx}", 12)`,
      `    set_scale("${pipRig}", vec3(1.18, 0.78, 1.18))`,
      `    set_rotation("${pipLeftShoulder}", vec3(10, 0, -24))`,
      `    set_rotation("${pipRightShoulder}", vec3(10, 0, 24))`,
      `    set_rotation("${pipLeftHip}", vec3(0, 0, -12))`,
      `    set_rotation("${pipRightHip}", vec3(0, 0, 12))`,
      `    tween("${pipLeftShoulder}", property: "rotation", to: vec3(0, 0, -9), duration: 0.18)`,
      `    tween("${pipRightShoulder}", property: "rotation", to: vec3(0, 0, 9), duration: 0.18)`,
      `    tween("${pipLeftHip}", property: "rotation", to: vec3(0, 0, -2.3), duration: 0.18)`,
      `    tween("${pipRightHip}", property: "rotation", to: vec3(0, 0, 2.3), duration: 0.18)`,
      '    Camera.shake(0.07)',
      '    wait(0.07)',
      `    set_scale("${pipRig}", vec3(0.94, 1.08, 0.94))`,
      `    tween("${pipRig}", property: "scale", to: vec3(1, 1, 1), duration: 0.1)`,
      '    wait(0.1)',
      '    self.landing_lock = false',
      '',
      'on timer(0.18):',
      '    if Game.FallOut == false:',
      '        if self.is_grounded():',
      '            if speed(self) > 0.65:',
      '                if self.landing_lock == false:',
      `                    burst_particles("${pipFootFx}", 4)`,
      '',
      'on timer(2.5):',
      '    if Game.FallOut == false:',
      `        set_scale("${pipLeftEyePivot}", vec3(1, 0.08, 1))`,
      `        set_scale("${pipRightEyePivot}", vec3(1, 0.08, 1))`,
      '        wait(0.08)',
      `        tween("${pipLeftEyePivot}", property: "scale", to: vec3(1, 1, 1), duration: 0.11)`,
      `        tween("${pipRightEyePivot}", property: "scale", to: vec3(1, 1, 1), duration: 0.11)`,
      '',
      'on receive_damage(amount):',
      '    if Game.FallOut == false:',
      '        if self.hurt_ready == true:',
      '            self.hurt_ready = false',
      '            Game.PipHearts = (Game.PipHearts - 1)',
      `            burst_particles("${pipFootFx}", 7)`,
      `            burst_particles("${pipImpactFx}", 14)`,
      '            Screen.flash(0.14, color: "#FF6F91")',
      '            Camera.shake(0.12)',
      `            set_scale("${pipHeadPivot}", vec3(1.08, 0.82, 1.08))`,
      `            tween("${pipHeadPivot}", property: "scale", to: vec3(1, 1, 1), duration: 0.22)`,
      `            set_rotation("${pipRig}", vec3(0, 0, -12))`,
      `            tween("${pipRig}", property: "rotation", to: vec3(0, 0, 0), duration: 0.24)`,
      '            if Game.PipHearts <= 0:',
      '                fire_event("PipDefeat", target: self, payload: amount)',
      '            else:',
      '                wait(0.32)',
      '                self.hurt_ready = true',
      '',
      'on event PipBounce(payload):',
      '    if Game.FallOut == false:',
      `        burst_particles("${pipFootFx}", 10)`,
      `        burst_particles("${pipImpactFx}", 18)`,
      '',
      'on event PipDefeat(payload):',
      '    if Game.FallOut == false:',
      '        Game.FallOut = true',
      '        Game.PipHearts = 0',
      '        self.run_pose = false',
      '        self.airborne_pose = true',
      '        self.fall_pose = true',
      '        self.dash_active = false',
      '        self.landing_lock = true',
      '        Game.PipBoost = false',
      '        timeline_control("pip-left-arm-run", command: "stop")',
      '        timeline_control("pip-right-arm-run", command: "stop")',
      '        timeline_control("pip-left-leg-run", command: "stop")',
      '        timeline_control("pip-right-leg-run", command: "stop")',
      '        timeline_control("pip-head-tilt", command: "stop")',
      '        timeline_control("pip-sprout-flutter", command: "stop")',
      '        timeline_control("pip-scarf-flutter", command: "stop")',
      `        set_particles("${pipDashFx}", false)`,
      `        set_particles("${pipAirFx}", false)`,
      `        burst_particles("${pipFootFx}", 32)`,
      `        burst_particles("${pipImpactFx}", 24)`,
      `        set_scale("${pipRig}", vec3(1.12, 0.72, 1.12))`,
      `        set_rotation("${pipRig}", vec3(0, 0, 8))`,
      '        wait(0.08)',
      `        set_scale("${pipRig}", vec3(0.92, 1.16, 0.92))`,
      `        tween("${pipRig}", property: "rotation", to: vec3(0, 0, -190), duration: 0.48)`,
      `        tween("${pipRig}", property: "scale", to: vec3(0.12, 0.12, 0.12), duration: 0.48)`,
      `        tween("${pipHeadPivot}", property: "rotation", to: vec3(0, 0, 18), duration: 0.2)`,
      `        tween("${pipLeftShoulder}", property: "rotation", to: vec3(0, 0, -112), duration: 0.2)`,
      `        tween("${pipRightShoulder}", property: "rotation", to: vec3(0, 0, 112), duration: 0.2)`,
      `        tween("${pipLeftHip}", property: "rotation", to: vec3(34, 0, -26), duration: 0.2)`,
      `        tween("${pipRightHip}", property: "rotation", to: vec3(-34, 0, 26), duration: 0.2)`,
      '        Screen.flash(0.22, color: "#FF6F91")',
      '        Camera.shake(0.18)',
      '        wait(0.56)',
      '        if Game.Checkpoint >= 1:',
      '            set_position(self, vec3(0, 1.45, 28))',
      '        else:',
      '            set_position(self, vec3(0, 1.45, -2))',
      '        apply_force(self, vector: vec3(0, 4, 0))',
      `        set_rotation("${pipRig}", vec3(0, 0, 0))`,
      `        set_scale("${pipRig}", vec3(0.38, 1.28, 0.38))`,
      `        set_rotation("${pipHeadPivot}", vec3(0, 0, 0))`,
      `        set_scale("${pipHeadPivot}", vec3(1, 1, 1))`,
      `        set_rotation("${pipSproutPivot}", vec3(0, 0, 0))`,
      `        set_rotation("${pipLeftShoulder}", vec3(0, 0, -9))`,
      `        set_rotation("${pipRightShoulder}", vec3(0, 0, 9))`,
      `        set_rotation("${pipLeftHip}", vec3(0, 0, -2.3))`,
      `        set_rotation("${pipRightHip}", vec3(0, 0, 2.3))`,
      `        tween("${pipRig}", property: "scale", to: vec3(1, 1, 1), duration: 0.3)`,
      '        timeline_control("pip-head-tilt", command: "restart")',
      '        timeline_control("pip-sprout-flutter", command: "restart")',
      '        timeline_control("pip-scarf-flutter", command: "restart")',
      `        burst_particles("${pipFootFx}", 38)`,
      `        burst_particles("${pipImpactFx}", 20)`,
      '        Screen.flash(0.18, color: "#B9FFF1")',
      '        self.jump_fx_ready = true',
      '        self.airborne_pose = false',
      '        self.fall_pose = false',
      '        self.landing_lock = false',
      '        self.hurt_ready = true',
      '        Game.PipHearts = 3',
      '        Game.FallOut = false',
      '',
      'detached:',
      `    timeline("${pipHeadPivot}", id: "pip-head-tilt", name: "Pip Head Tilt", property: "rotation", to: vec3(0, 0, 3), duration: 0.82, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)`,
      `    timeline("${pipSproutPivot}", id: "pip-sprout-flutter", name: "Pip Sprout Flutter", property: "rotation", to: vec3(0, 0, 14), duration: 0.46, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)`,
      `    timeline("${pipScarfPivot}", id: "pip-scarf-flutter", name: "Pip Scarf Flutter", property: "rotation", to: vec3(-5, 0, 14), duration: 0.34, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)`,
      `    timeline("${pipLeftShoulder}", id: "pip-left-arm-run", name: "Pip Left Arm Run", property: "rotation", to: vec3(36, 0, -9), duration: 0.19, curve: "smooth", space: "local", loop: true, ping_pong: true)`,
      `    timeline("${pipRightShoulder}", id: "pip-right-arm-run", name: "Pip Right Arm Run", property: "rotation", to: vec3(-36, 0, 9), duration: 0.19, curve: "smooth", space: "local", loop: true, ping_pong: true)`,
      `    timeline("${pipLeftHip}", id: "pip-left-leg-run", name: "Pip Left Leg Run", property: "rotation", to: vec3(-28, 0, -2.3), duration: 0.19, curve: "smooth", space: "local", loop: true, ping_pong: true)`,
      `    timeline("${pipRightHip}", id: "pip-right-leg-run", name: "Pip Right Leg Run", property: "rotation", to: vec3(28, 0, 2.3), duration: 0.19, curve: "smooth", space: "local", loop: true, ping_pong: true)`,
    ].join('\n'),
  );
  store.attachScript(playerId, pipMotionBlueprint);

  // Pip is one self-contained, live-linked prefab: controller, primitive body rig, animation pivots,
  // face, scarf, all four dormant VFX emitters, and both behavior Blueprints. createPrefabFromObject
  // turns this authored hierarchy into the first instance and rewrites its graph targets to prefab-local
  // definition ids, so every placed Pip drives its own limbs and particles.
  const pipPrefabId = store.createPrefabFromObject(
    playerId,
    'Pip — Playable Character',
    characterFolder,
  );
  if (!pipPrefabId) throw new Error('Could not create the reusable Pip character prefab.');
  // Start safely above the turf while Rapier's browser WASM initializes; a floorless groundLevel is
  // required for real gaps, so spawning at the surface could otherwise let the first frame sink.
  store.updateTransform(playerId, 'position', [0, 2.4, -2]);

  const seedBlueprint = compile(
    'Sun Seed Sparkle',
    'Spins each seed, switches off its idle halo, pops a cartoon sunburst and awards the score once.',
    [
      'blueprint Sun_Seed_Sparkle',
      '',
      'var value: number = 10',
      'var vfx_anchor: string = ""',
      'var claimed: boolean = false',
      '',
      'on start:',
      '    timeline_control("seed-float", command: "play")',
      '',
      'on update(dt):',
      '    self.rotate(axis: "y", amount: 95)',
      '',
      'on trigger_enter(other):',
      '    if self.claimed == false:',
      '        self.claimed = true',
      '        Game.Score = (Game.Score + self.value)',
      '        set_particles(self.vfx_anchor, false)',
      '        burst_particles(self.vfx_anchor, 26)',
      '        Screen.flash(0.12, color: "#FFF3A1")',
      '        Camera.shake(0.035)',
      '        destroy(self)',
      '',
      'detached:',
      '    timeline(self, id: "seed-float", name: "Sun Seed Float", property: "position", to: vec3(0, 0.15, 0), duration: 0.72, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );

  const seedSpots: Vector3Tuple[] = [
    [-2, 1.05, 0],
    [2, 1.05, 4.5],
    [-2.8, 1.7, 9],
    [2.4, 2.15, 14],
    [0, 2.65, 19],
    [2.8, 1.95, 23],
    [-2.5, 1.2, 28],
    [2.5, 1.2, 34.5],
    [0, 2.7, 38],
    [-3, 3.95, 42],
  ];
  seedSpots.forEach((position, index) => {
    const result = store.createRoleObject('collectible', {
      kind: 'sphere',
      name: `Sun Seed ${String(index + 1).padStart(2, '0')}`,
      position,
      color: '#FFD84F',
      parentId: courseRoot,
    });
    if (!result.ok || !result.objectId) throw new Error(`Could not create Sun Seed ${index + 1}.`);
    store.updateTransform(result.objectId, 'scale', [0.72, 0.72, 0.28]);
    store.setObjectMaterial(result.objectId, mats.gold);
    store.setObjectVariable(result.objectId, 'value', 10);
    for (let rayIndex = 0; rayIndex < 4; rayIndex += 1) {
      const angle = (rayIndex / 4) * Math.PI * 2;
      addPart({
        kind: 'capsule',
        name: `Sun Seed ${index + 1} — Ray ${rayIndex + 1}`,
        position: [Math.cos(angle) * 0.78, Math.sin(angle) * 0.78, 0],
        scale: [0.11, 0.3, 0.1],
        rotation: [0, 0, Math.PI / 2 - angle],
        materialId: rayIndex % 2 === 0 ? mats.gold : mats.cream,
        parentId: result.objectId,
      });
    }
    const seedFx = addEmitter({
      name: `Sun Seed ${String(index + 1).padStart(2, '0')} — Sparkle Halo`,
      position,
      parentId: vfxRoot,
      preset: 'magic',
      patch: {
        enabled: true,
        looping: true,
        rate: 6,
        burst: 0,
        maxParticles: 38,
        shape: 'sphere',
        shapeRadius: 0.38,
        speed: 0.5,
        speedJitter: 0.6,
        gravity: -0.12,
        drag: 0.35,
        lifetime: 0.78,
        lifetimeJitter: 0.25,
        startSize: 0.13,
        endSize: 0.01,
        startColor: '#FFF7A8',
        endColor: '#FF7FAA',
        startOpacity: 0.92,
        endOpacity: 0,
        worldSpace: true,
        blend: 'additive',
        light: false,
      },
    });
    store.setObjectVariable(result.objectId, 'vfx_anchor', seedFx);
    store.attachScript(result.objectId, seedBlueprint);
  });

  // Bounce pad: a reusable behaviour on an ordinary fixed cube, with a small live sparkle bed.
  const bouncePad = addPart({
    kind: 'cube',
    name: 'Coral Bloom Bounce Pad',
    position: [0, 0.34, 33],
    scale: [2.4, 0.28, 2.4],
    materialId: mats.coral,
    parentId: courseRoot,
    solid: true,
  });
  store.setObjectVariable(bouncePad, 'launch_power', 10.8);
  const bouncePadVisual = store.createObjectWithProps('empty', {
    name: 'Coral Bloom — Petal Rig',
    position: [0, 0.34, 33],
    parentId: sceneryRoot,
  });
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    addPart({
      kind: 'sphere',
      name: `Coral Bloom — Petal ${index + 1}`,
      position: [Math.cos(angle) * 0.82, 0.22, Math.sin(angle) * 0.82],
      scale: [0.68, 0.17, 0.48],
      rotation: [0, -angle, 0],
      materialId: index % 2 === 0 ? mats.coral : mats.cream,
      parentId: bouncePadVisual,
    });
  }
  addPart({
    kind: 'sphere',
    name: 'Coral Bloom — Jelly Centre',
    position: [0, 0.27, 0],
    scale: [0.72, 0.25, 0.72],
    materialId: mats.gold,
    parentId: bouncePadVisual,
  });

  store.addParticles(bouncePad, 'dust');
  store.updateParticles(bouncePad, {
    looping: true,
    rate: 5,
    burst: 0,
    maxParticles: 54,
    shape: 'disc',
    shapeRadius: 0.95,
    speed: 0.8,
    speedJitter: 0.58,
    direction: [0, 1, 0],
    gravity: -0.16,
    drag: 0.55,
    lifetime: 0.72,
    lifetimeJitter: 0.2,
    startSize: 0.18,
    endSize: 0.52,
    startColor: '#FFF4DF',
    endColor: '#70F3D5',
    startOpacity: 0.72,
    endOpacity: 0,
    worldSpace: true,
    blend: 'normal',
    light: false,
  });
  const bouncePadBlueprint = compile(
    'Coral Bloom Bounce',
    'Launches the player with a petal squash, cream cloud burst and a restrained camera punch.',
    [
      'blueprint Coral_Bloom_Bounce',
      '',
      'var launch_power: number = 10.8',
      '',
      'on collision_enter(other):',
      '    apply_force(other, vector: vec_scale(vec3(0, 1, 0), self.launch_power))',
      '    burst_particles(self, 28)',
      '    fire_event("PipBounce", target: other, payload: self.launch_power)',
      `    set_rotation("${bouncePadVisual}", vec3(0, 18, 0))`,
      `    set_scale("${bouncePadVisual}", vec3(1.18, 0.62, 1.18))`,
      `    tween("${bouncePadVisual}", property: "scale", to: vec3(1, 1, 1), duration: 0.24)`,
      `    tween("${bouncePadVisual}", property: "rotation", to: vec3(0, 0, 0), duration: 0.28)`,
      '    Screen.flash(0.08, color: "#B9FFF1")',
      '    Camera.shake(0.08)',
    ].join('\n'),
  );
  store.attachScript(bouncePad, bouncePadBlueprint);

  const grumbleWobbleBlueprint = compile(
    'Grumble Bud Wobble',
    'Keeps each flower critter bobbing and tilting like a soft wind-up toy.',
    [
      'blueprint Grumble_Bud_Wobble',
      '',
      'on start:',
      '    timeline_control("grumble-bob", command: "play")',
      '    timeline_control("grumble-tilt", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "grumble-bob", name: "Bud Bob", property: "position", to: vec3(0, 0.09, 0), duration: 0.55, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
      '    timeline(self, id: "grumble-tilt", name: "Bud Tilt", property: "rotation", to: vec3(0, 0, 7), duration: 0.72, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );
  const grumbleBlueprint = compile(
    'Grumble Bud Bop',
    'Chases gently, then squashes into a violet-and-mint cartoon poof when Pip bops it.',
    [
      'blueprint Grumble_Bud_Bop',
      '',
      'var health: number = 70',
      'var speed: number = 1.35',
      'var damage: number = 34',
      'var aggro_range: number = 6.5',
      '',
      'on update(dt):',
      '    if self.health > 0:',
      '        if AI.distance_to_player() < self.aggro_range:',
      '            self.move_to(Player.location, speed: self.speed)',
      '',
      'on collision_enter(other):',
      '    if self.damage > 0:',
      '        apply_damage(other, self.damage)',
      '',
      'on receive_damage(amount):',
      '    if self.health > 0:',
      '        self.health = (self.health - amount)',
      '        burst_particles(self, 34)',
      '        Camera.shake(0.08)',
      '        if self.health <= 0:',
      '            set_scale(self, vec3(1.24, 0.62, 1.24))',
      '            tween(self, property: "scale", to: vec3(0.08, 0.08, 0.08), duration: 0.5)',
      '            Screen.flash(0.07, color: "#D9CFFF")',
      '            wait(0.58)',
      '            destroy(self)',
    ].join('\n'),
  );
  const addGrumble = (name: string, position: Vector3Tuple): string => {
    const result = store.createRoleObject('enemy', {
      kind: 'empty',
      name,
      position,
      parentId: courseRoot,
    });
    if (!result.ok || !result.objectId) throw new Error(`Could not create ${name}.`);
    const id = result.objectId;
    store.updateTransform(id, 'scale', [0.9, 0.9, 0.9]);
    // The runtime applies the first 35 damage before Receive Damage fires. Starting at 70 leaves one
    // authored callback alive to play the squash/poof before this Blueprint deliberately destroys the bud.
    store.setObjectVariable(id, 'health', 70);
    store.setObjectVariable(id, 'speed', 1.35);
    store.setObjectVariable(id, 'damage', 34);
    store.setObjectVariable(id, 'aggro_range', 6.5);
    const rig = store.createObjectWithProps('empty', {
      name: `${name} — Wobble Rig`,
      position: [0, 0, 0],
      parentId: id,
    });
    addPart({ kind: 'sphere', name: `${name} Body`, position: [0, 0.62, 0], scale: [0.92, 0.86, 0.82], materialId: mats.violet, parentId: rig });
    addPart({ kind: 'sphere', name: `${name} Left Eye`, position: [-0.2, 0.72, 0.42], scale: [0.13, 0.16, 0.1], materialId: mats.ink, parentId: rig });
    addPart({ kind: 'sphere', name: `${name} Right Eye`, position: [0.2, 0.72, 0.42], scale: [0.13, 0.16, 0.1], materialId: mats.ink, parentId: rig });
    addPart({ kind: 'sphere', name: `${name} Left Foot`, position: [-0.28, 0.12, 0.12], scale: [0.42, 0.2, 0.46], materialId: mats.ink, parentId: rig });
    addPart({ kind: 'sphere', name: `${name} Right Foot`, position: [0.28, 0.12, 0.12], scale: [0.42, 0.2, 0.46], materialId: mats.ink, parentId: rig });
    addPart({ kind: 'capsule', name: `${name} Sprout`, position: [0, 1.2, 0], scale: [0.13, 0.3, 0.13], rotation: [0, 0, 0.28], materialId: mats.leaf, parentId: rig });
    store.attachScript(rig, grumbleWobbleBlueprint);
    store.addParticles(id, 'magic');
    store.updateParticles(id, {
      enabled: false,
      looping: false,
      rate: 0,
      burst: 0,
      maxParticles: 58,
      shape: 'sphere',
      shapeRadius: 0.34,
      speed: 3.2,
      speedJitter: 0.7,
      direction: [0, 1, 0],
      gravity: 2.4,
      drag: 0.42,
      lifetime: 0.5,
      lifetimeJitter: 0.22,
      startSize: 0.2,
      endSize: 0.025,
      startColor: '#CDBFFF',
      endColor: '#70F3D5',
      startOpacity: 1,
      endOpacity: 0,
      worldSpace: true,
      blend: 'additive',
      light: false,
    });
    store.attachScript(id, grumbleBlueprint);
    return id;
  };
  addGrumble('Grumble Bud A', [-3.7, 0.82, 30]);
  addGrumble('Grumble Bud B', [3.7, 0.82, 32]);

  // A midpoint checkpoint and forgiving fall recovery turn the scene into a complete, replayable slice.
  const pinwheelBlueprint = compile(
    'Checkpoint Pinwheel Spin',
    'Slowly turns the mint checkpoint flower so it reads as a friendly animated landmark.',
    [
      'blueprint Checkpoint_Pinwheel_Spin',
      '',
      'on start:',
      '    timeline_control("pinwheel-spin", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "pinwheel-spin", name: "Pinwheel Spin", property: "rotation", to: vec3(0, 0, 360), duration: 7.5, curve: "linear", space: "local", relative: true, loop: true)',
    ].join('\n'),
  );
  const checkpointVisual = store.createObjectWithProps('empty', {
    name: 'Sky Garden Checkpoint — Pinwheel',
    position: [-4.55, 0.16, 27],
    parentId: sceneryRoot,
  });
  addPart({ kind: 'capsule', name: 'Checkpoint Mint Post', position: [0, 1.05, 0], scale: [0.13, 1.65, 0.13], materialId: mats.teal, parentId: checkpointVisual });
  addPart({ kind: 'sphere', name: 'Checkpoint Post Foot', position: [0, 0.08, 0], scale: [0.42, 0.16, 0.42], materialId: mats.cream, parentId: checkpointVisual });
  const checkpointPinwheel = store.createObjectWithProps('empty', {
    name: 'Checkpoint — Spinning Flower',
    position: [0, 2.18, 0],
    parentId: checkpointVisual,
  });
  for (let index = 0; index < 6; index += 1) {
    const angle = (index / 6) * Math.PI * 2;
    addPart({
      kind: 'capsule',
      name: `Checkpoint Petal ${index + 1}`,
      position: [Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 0],
      scale: [0.16, 0.42, 0.12],
      rotation: [0, 0, Math.PI / 2 - angle],
      materialId: index % 2 === 0 ? mats.teal : mats.cream,
      parentId: checkpointPinwheel,
    });
  }
  addPart({ kind: 'sphere', name: 'Checkpoint Sunny Centre', position: [0, 0, 0.08], scale: [0.34, 0.34, 0.2], materialId: mats.gold, parentId: checkpointPinwheel });
  store.attachScript(checkpointPinwheel, pinwheelBlueprint);
  const checkpointFx = addEmitter({
    name: 'Checkpoint — Mint Star Wisps',
    position: [0, 2.18, 0],
    parentId: checkpointVisual,
    preset: 'magic',
    patch: {
      enabled: true,
      looping: true,
      rate: 5,
      burst: 0,
      maxParticles: 70,
      shape: 'sphere',
      shapeRadius: 0.62,
      speed: 0.72,
      speedJitter: 0.62,
      gravity: -0.18,
      drag: 0.35,
      lifetime: 1.05,
      lifetimeJitter: 0.3,
      startSize: 0.14,
      endSize: 0.015,
      startColor: '#E9FFF8',
      endColor: '#39D7C5',
      startOpacity: 0.9,
      endOpacity: 0,
      worldSpace: true,
      blend: 'additive',
      light: true,
    },
  });
  const checkpoint = addPart({
    kind: 'cube',
    name: 'Sky Garden Checkpoint Trigger',
    position: [0, 1.4, 27],
    scale: [6.5, 2.8, 2.2],
    materialId: mats.teal,
    parentId: courseRoot,
    trigger: true,
    hidden: true,
  });
  const checkpointBlueprint = compile(
    'Cloudstep Checkpoint',
    'Activates the midpoint respawn and gives the player clear feedback.',
    [
      'blueprint Cloudstep_Checkpoint',
      '',
      'on trigger_enter(other):',
      '    if Game.Checkpoint < 1:',
      '        Game.Checkpoint = 1',
      `        burst_particles("${checkpointFx}", 38)`,
      `        set_scale("${checkpointVisual}", vec3(1.16, 0.82, 1.16))`,
      `        tween("${checkpointVisual}", property: "scale", to: vec3(1, 1, 1), duration: 0.3)`,
      '        Screen.flash(0.16, color: "#70F3D5")',
      '        Camera.shake(0.06)',
    ].join('\n'),
  );
  store.attachScript(checkpoint, checkpointBlueprint);

  const fallTrigger = addPart({
    kind: 'cube',
    name: 'Cloud Sea Respawn Trigger',
    position: [0, -7.5, 27],
    scale: [72, 2, 92],
    materialId: mats.coral,
    parentId: courseRoot,
    trigger: true,
    hidden: true,
  });
  const respawnBlueprint = compile(
    'Cloudstep Respawn',
    'Routes a cloud-sea fall through Pip’s authored defeat animation and checkpoint recovery.',
    [
      'blueprint Cloudstep_Respawn',
      '',
      'on trigger_enter(other):',
      '    if Game.FallOut == false:',
      '        Game.PipHearts = 0',
      '        fire_event("PipDefeat", target: other, payload: 1)',
    ].join('\n'),
  );
  store.attachScript(fallTrigger, respawnBlueprint);

  // Goal sculpture: a smiling sun made from one orb plus eight capsule rays.
  const goalVisual = store.createObjectWithProps('empty', {
    name: 'Sunny — Goal Sculpture',
    position: [0, 6.5, 54],
    parentId: courseRoot,
  });
  addPart({ kind: 'sphere', name: 'Sunny Core', position: [0, 0, 0], scale: [1.3, 1.3, 0.72], materialId: mats.gold, parentId: goalVisual });
  const goalRays = store.createObjectWithProps('empty', {
    name: 'Sunny — Spinning Ray Rig',
    position: [0, 0, -0.08],
    parentId: goalVisual,
  });
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addPart({
      kind: 'capsule',
      name: `Sunny Ray ${index + 1}`,
      position: [Math.cos(angle) * 1.05, Math.sin(angle) * 1.05, -0.05],
      scale: [0.22, 0.56, 0.22],
      rotation: [0, 0, Math.PI / 2 - angle],
      materialId: index % 2 === 0 ? mats.gold : mats.coral,
      parentId: goalRays,
    });
  }
  addPart({ kind: 'sphere', name: 'Sunny Left Eye', position: [-0.32, 0.14, 0.42], scale: [0.14, 0.2, 0.1], materialId: mats.ink, parentId: goalVisual });
  addPart({ kind: 'sphere', name: 'Sunny Right Eye', position: [0.32, 0.14, 0.42], scale: [0.14, 0.2, 0.1], materialId: mats.ink, parentId: goalVisual });
  const sunnyFloatBlueprint = compile(
    'Sunny Goal Float',
    'Gives the smiling goal a slow storybook hover while its rays turn independently.',
    [
      'blueprint Sunny_Goal_Float',
      '',
      'on start:',
      '    timeline_control("sunny-float", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "sunny-float", name: "Sunny Float", property: "position", to: vec3(0, 0.3, 0), duration: 1.15, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );
  const sunnySpinBlueprint = compile(
    'Sunny Ray Spin',
    'Turns the alternating coral-and-gold sun rays like a celebratory paper rosette.',
    [
      'blueprint Sunny_Ray_Spin',
      '',
      'on start:',
      '    timeline_control("sunny-spin", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "sunny-spin", name: "Sunny Ray Spin", property: "rotation", to: vec3(0, 0, 360), duration: 9, curve: "linear", space: "local", relative: true, loop: true)',
    ].join('\n'),
  );
  store.attachScript(goalVisual, sunnyFloatBlueprint);
  store.attachScript(goalRays, sunnySpinBlueprint);
  store.addParticles(goalVisual, 'magic');
  store.updateParticles(goalVisual, {
    looping: true,
    rate: 12,
    burst: 0,
    maxParticles: 120,
    shape: 'sphere',
    shapeRadius: 1.4,
    speed: 0.9,
    speedJitter: 0.65,
    gravity: -0.12,
    drag: 0.08,
    lifetime: 1.7,
    lifetimeJitter: 0.35,
    startSize: 0.14,
    endSize: 0,
    startColor: '#FFF3A1',
    endColor: '#FF70A6',
    startOpacity: 1,
    endOpacity: 0,
    worldSpace: true,
    light: true,
  });

  const goalTrigger = addPart({
    kind: 'cube',
    name: 'Course Clear Trigger',
    position: [0, 6.1, 54],
    scale: [3.2, 3.8, 3.2],
    materialId: mats.gold,
    parentId: courseRoot,
    trigger: true,
    hidden: true,
  });
  const goalBlueprint = compile(
    'Cloudstep Course Clear',
    'Sets the win state once and lets the bound HUD present the course-clear celebration.',
    [
      'blueprint Cloudstep_Course_Clear',
      '',
      'var claimed: boolean = false',
      '',
      'on trigger_enter(other):',
      '    if (self.claimed == false):',
      '        self.claimed = true',
      '        Game.LevelComplete = true',
      `        burst_particles("${goalVisual}", 90)`,
      `        set_scale("${goalVisual}", vec3(1.24, 0.82, 1.24))`,
      `        tween("${goalVisual}", property: "scale", to: vec3(1, 1, 1), duration: 0.36)`,
      '        Screen.flash(0.3, color: "#FFF1A8")',
      '        Camera.shake(0.16)',
    ].join('\n'),
  );
  store.attachScript(goalTrigger, goalBlueprint);

  // Start/finish arches frame the route without borrowing a character or landmark from another game.
  const addArch = (name: string, position: Vector3Tuple, color: string, materialId: string) => {
    const root = store.createObjectWithProps('empty', { name, position, parentId: sceneryRoot });
    addPart({ kind: 'capsule', name: `${name} Left Post`, position: [-4.4, 1.7, 0], scale: [0.34, 2.8, 0.34], materialId, parentId: root });
    addPart({ kind: 'capsule', name: `${name} Right Post`, position: [4.4, 1.7, 0], scale: [0.34, 2.8, 0.34], materialId, parentId: root });
    addPart({ kind: 'capsule', name: `${name} Crown Left`, position: [-2.2, 5.6, 0], scale: [0.3, 2.8, 0.3], rotation: [0, 0, -0.9], materialId, parentId: root });
    addPart({ kind: 'capsule', name: `${name} Crown Right`, position: [2.2, 5.6, 0], scale: [0.3, 2.8, 0.3], rotation: [0, 0, 0.9], materialId, parentId: root });
    addPart({ kind: 'sphere', name: `${name} Crown Jewel`, position: [0, 7.35, 0], scale: [0.58, 0.58, 0.42], materialId, parentId: root });
    const light = store.createObjectWithProps('light', { name: `${name} Glow`, position: [0, 6.4, 0], parentId: root });
    store.setObjectLight(light, { type: 'point', color, intensity: 9, distance: 9, castShadow: false });
  };
  addArch('Welcome Arch', [0, 0, 4], '#39D7C5', mats.teal);
  addArch('Sun Crown Arch', [0, 4.5, 57], '#FFD84F', mats.gold);

  const flowerSwayBlueprint = compile(
    'Cloudstep Flower Sway',
    'A soft looping tilt that gives every decorative bloom the same breezy cartoon rhythm.',
    [
      'blueprint Cloudstep_Flower_Sway',
      '',
      'var delay: number = 0',
      '',
      'on start:',
      '    wait(self.delay)',
      '    timeline_control("flower-sway", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "flower-sway", name: "Flower Sway", property: "rotation", to: vec3(0, 0, 6), duration: 0.95, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );
  const addFlower = (name: string, position: Vector3Tuple, petalMaterial: string, delay = 0) => {
    const root = store.createObjectWithProps('empty', { name, position, parentId: sceneryRoot });
    addPart({ kind: 'capsule', name: `${name} Stem`, position: [0, 0.28, 0], scale: [0.07, 0.42, 0.07], materialId: mats.leaf, parentId: root });
    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      addPart({
        kind: 'sphere',
        name: `${name} Petal ${index + 1}`,
        position: [Math.cos(angle) * 0.18, 0.62 + Math.sin(angle) * 0.18, 0],
        scale: [0.22, 0.16, 0.1],
        materialId: petalMaterial,
        parentId: root,
      });
    }
    addPart({ kind: 'sphere', name: `${name} Centre`, position: [0, 0.62, 0.06], scale: [0.18, 0.18, 0.12], materialId: mats.gold, parentId: root });
    store.setObjectVariable(root, 'delay', delay);
    store.attachScript(root, flowerSwayBlueprint);
  };
  [
    ['Start Bloom A', [-4.5, 0.05, 1.5], mats.coral, 0],
    ['Start Bloom B', [4.4, 0.05, 2.7], mats.violet, 0.14],
    ['Garden Bloom A', [-5.3, 0.2, 28], mats.coral, 0.28],
    ['Garden Bloom B', [5.1, 0.2, 31], mats.violet, 0.08],
    ['Garden Bloom C', [-4.7, 0.2, 33], mats.gold, 0.2],
    ['Crown Bloom A', [-4.2, 4.55, 52], mats.teal, 0.12],
    ['Crown Bloom B', [4.2, 4.55, 55], mats.coral, 0.26],
  ].forEach(([name, position, petal, delay]) => addFlower(name as string, position as Vector3Tuple, petal as string, delay as number));

  const addGrassTuft = (name: string, position: Vector3Tuple, delay: number, lean: number) => {
    const root = store.createObjectWithProps('empty', { name, position, parentId: sceneryRoot });
    store.updateTransform(root, 'rotation', [0, 0, lean]);
    [
      [-0.16, 0.28, -0.18, 0.08, 0.42, -0.22],
      [0, 0.36, 0, 0.09, 0.56, 0],
      [0.17, 0.27, 0.13, 0.075, 0.4, 0.24],
    ].forEach(([x, y, z, width, height, bladeLean], index) => {
      addPart({
        kind: 'capsule',
        name: `${name} Blade ${index + 1}`,
        position: [x, y, z],
        scale: [width, height, width],
        rotation: [0, 0, bladeLean],
        materialId: index === 1 ? mats.teal : mats.leaf,
        parentId: root,
      });
    });
    addPart({ kind: 'sphere', name: `${name} Dewdrop`, position: [0, 0.76, 0], scale: [0.07, 0.07, 0.07], materialId: mats.gold, parentId: root });
    store.setObjectVariable(root, 'delay', delay);
    store.attachScript(root, flowerSwayBlueprint);
  };
  [
    ['Start Wind Grass A', [-4.2, 0.03, -4.9], 0.04, -0.04],
    ['Start Wind Grass B', [-2.6, 0.03, 2.2], 0.18, 0.06],
    ['Start Wind Grass C', [2.8, 0.03, -0.8], 0.3, -0.03],
    ['Start Wind Grass D', [4.6, 0.03, 4.2], 0.1, 0.05],
    ['Garden Wind Grass A', [-5.7, 0.18, 31], 0.24, -0.04],
    ['Garden Wind Grass B', [4.8, 0.18, 27.8], 0.06, 0.03],
    ['Garden Wind Grass C', [3.8, 0.18, 33.5], 0.34, -0.06],
    ['Crown Wind Grass A', [-4.5, 4.53, 55.8], 0.16, 0.04],
    ['Crown Wind Grass B', [4.5, 4.53, 52.2], 0.28, -0.05],
  ].forEach(([name, position, delay, lean]) => addGrassTuft(name as string, position as Vector3Tuple, delay as number, lean as number));

  const sceneryDriftBlueprint = compile(
    'Cloudstep Scenery Drift',
    'Staggers cloud banks and underside lobes through a soft wind drift and tiny squash-free breathe.',
    [
      'blueprint Cloudstep_Scenery_Drift',
      '',
      'var drift: number = 1.8',
      'var lift: number = 0.15',
      'var drift_time: number = 8.5',
      'var delay: number = 0',
      'var breathe: number = 1.03',
      '',
      'on start:',
      '    wait(self.delay)',
      '    timeline_control("scenery-drift", command: "play")',
      '    timeline_control("scenery-breathe", command: "play")',
      '',
      'detached:',
      '    timeline(self, id: "scenery-drift", name: "Scenery Wind Drift", property: "position", to: vec3(self.drift, self.lift, 0), duration: self.drift_time, curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
      '    timeline(self, id: "scenery-breathe", name: "Scenery Breathe", property: "scale", to: vec3(self.breathe, self.breathe, self.breathe), duration: (self.drift_time * 0.45), curve: "smooth", space: "local", relative: true, loop: true, ping_pong: true)',
    ].join('\n'),
  );

  const addCloud = (name: string, position: Vector3Tuple, scale: number, drift: number, driftTime: number, delay: number) => {
    const root = store.createObjectWithProps('empty', { name, position, parentId: sceneryRoot });
    addPart({ kind: 'sphere', name: `${name} A`, position: [-1.1 * scale, 0, 0], scale: [2.2 * scale, 1.05 * scale, 0.9 * scale], materialId: mats.cream, parentId: root });
    addPart({ kind: 'sphere', name: `${name} B`, position: [0, 0.35 * scale, 0], scale: [2.7 * scale, 1.45 * scale, 1.05 * scale], materialId: mats.cream, parentId: root });
    addPart({ kind: 'sphere', name: `${name} C`, position: [1.45 * scale, -0.05 * scale, 0], scale: [1.9 * scale, 0.95 * scale, 0.82 * scale], materialId: mats.cream, parentId: root });
    store.setObjectVariable(root, 'drift', drift);
    store.setObjectVariable(root, 'lift', drift > 0 ? 0.15 : -0.12);
    store.setObjectVariable(root, 'drift_time', driftTime);
    store.setObjectVariable(root, 'delay', delay);
    store.setObjectVariable(root, 'breathe', 1.03);
    store.attachScript(root, sceneryDriftBlueprint);
    return root;
  };
  addCloud('West Cloud Bank', [-10.5, 5.5, 13], 1.25, 1.8, 8.5, 0);
  addCloud('East Cloud Bank', [10.8, 7.5, 27], 1.05, -1.65, 11.5, 0.7);
  addCloud('Upper West Cloud', [-11.5, 10.5, 43], 1.4, 1.95, 11.5, 1.2);
  addCloud('Crown Cloud Bank', [11.2, 12.5, 57], 1.3, -1.8, 8.5, 0.35);

  selectActiveObjects(useEditorStore.getState())
    .filter((object) => object.name.includes('Floating Rock') || object.name.includes('Floating Lobe'))
    .forEach((object, index) => {
      store.setObjectVariable(object.id, 'drift', 0);
      store.setObjectVariable(object.id, 'lift', 0.08 + (index % 3) * 0.02);
      store.setObjectVariable(object.id, 'drift_time', 1.5 + (index % 4) * 0.2);
      store.setObjectVariable(object.id, 'delay', (index % 5) * 0.11);
      store.setObjectVariable(object.id, 'breathe', 1.02);
      store.attachScript(object.id, sceneryDriftBlueprint);
    });

  // A large graphic sun is deliberately another editable primitive rig, not a bitmap backdrop.
  const distantSun = store.createObjectWithProps('empty', {
    name: 'Distant Jelly Sun',
    position: [-17, 18, 72],
    parentId: sceneryRoot,
  });
  addPart({ kind: 'sphere', name: 'Distant Jelly Sun Core', position: [0, 0, 0], scale: [5.2, 5.2, 1.8], materialId: mats.gold, parentId: distantSun });
  const distantSunRays = store.createObjectWithProps('empty', { name: 'Distant Jelly Sun — Ray Rig', position: [0, 0, -0.1], parentId: distantSun });
  for (let index = 0; index < 8; index += 1) {
    const angle = (index / 8) * Math.PI * 2;
    addPart({
      kind: 'capsule',
      name: `Distant Jelly Sun Ray ${index + 1}`,
      position: [Math.cos(angle) * 5.2, Math.sin(angle) * 5.2, 0],
      scale: [0.5, 1.8, 0.36],
      rotation: [0, 0, Math.PI / 2 - angle],
      materialId: index % 2 === 0 ? mats.gold : mats.cream,
      parentId: distantSunRays,
    });
  }
  store.attachScript(distantSun, sunnyFloatBlueprint);
  store.attachScript(distantSunRays, sunnySpinBlueprint);

  addEmitter({
    name: 'Garden Wind Motes',
    position: [0, 3, 27],
    parentId: vfxRoot,
    preset: 'magic',
    patch: {
      enabled: true,
      looping: true,
      rate: 14,
      burst: 0,
      maxParticles: 96,
      shape: 'box',
      shapeRadius: 30,
      speed: 0.55,
      speedJitter: 0.55,
      direction: [0.9, 0.12, 0.25],
      gravity: -0.03,
      drag: 0.04,
      lifetime: 6.5,
      lifetimeJitter: 0.18,
      startSize: 0.07,
      endSize: 0.015,
      startColor: '#FFF7C8',
      endColor: '#7EF0DB',
      startOpacity: 0.32,
      endOpacity: 0,
      worldSpace: false,
      blend: 'additive',
      light: false,
      gpu: true,
    },
  });
  addEmitter({
    name: 'Cloud Sea Mist',
    position: [0, -3.2, 27],
    parentId: vfxRoot,
    preset: 'dust',
    patch: {
      enabled: true,
      looping: true,
      rate: 4,
      burst: 0,
      maxParticles: 36,
      shape: 'disc',
      shapeRadius: 26,
      speed: 0.25,
      speedJitter: 0.72,
      direction: [0, 1, 0],
      gravity: -0.08,
      drag: 0.2,
      lifetime: 5,
      lifetimeJitter: 0.25,
      startSize: 1.2,
      endSize: 3.6,
      startColor: '#FFFBE8',
      endColor: '#B9FFF1',
      startOpacity: 0.08,
      endOpacity: 0,
      worldSpace: true,
      blend: 'normal',
      light: false,
    },
  });

  const goalLight = store.createObjectWithProps('light', {
    name: 'Sunny Goal Light',
    position: [0, 8.5, 52],
    parentId: sceneryRoot,
  });
  store.setObjectLight(goalLight, { type: 'point', color: '#FFD76A', intensity: 16, distance: 15, castShadow: false });

  const camera = store.createObjectWithProps('camera', {
    name: 'Cloudstep Preview Camera',
    position: [11, 8, -10],
    parentId: worldRoot,
  });
  store.updateTransform(camera, 'rotation', [-0.28, 0.7, 0.18]);

  // Resolution-independent HUD: compact glassy cards plus a bound celebration overlay.
  const hudId = store.createUIDocument('Cloudstep HUD', 'screen', uiFolder);
  store.updateUIDocument(hudId, { visibleOnStart: true, renderMode: 'dom' });
  // Screen documents render globally, but this normal scene reference also carries the HUD through
  // project-package dependency collection. WorldUIAnchor ignores screen-surface documents.
  store.attachUI(worldRoot, hudId);
  const hud = useEditorStore.getState().uiDocuments.find((document) => document.id === hudId)!;
  store.updateUIElement(hudId, hud.root.id, {
    name: 'Cloudstep HUD Root',
    className: 'cloudstep-hud',
    anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 },
    style: { width: '100%', height: '100%', padding: '0', display: 'block' },
  });

  const speedLines = store.addUIElement(hudId, hud.root.id, 'panel');
  store.updateUIElement(hudId, speedLines, {
    name: 'Pip Dash Speed Lines',
    className: 'speed-lines',
    anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 },
    style: { width: '100%', height: '100%' },
  });
  store.setUIBinding(hudId, speedLines, 'visible', 'PipBoost && LevelComplete == false && FallOut == false');

  const topBar = store.addUIElement(hudId, hud.root.id, 'panel');
  store.updateUIElement(hudId, topBar, {
    name: 'Responsive Top Bar',
    className: 'top-bar',
    anchor: { h: 'stretch', v: 'top', offsetX: 24, offsetY: 22 },
    style: {
      display: 'flex',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: '12px',
      width: '100%',
    },
  });

  const brand = store.addUIElement(hudId, topBar, 'panel');
  store.updateUIElement(hudId, brand, {
    name: 'Course Card',
    className: 'course-card',
    style: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '13px 16px' },
  });
  const eyebrow = store.addUIElement(hudId, brand, 'text');
  store.updateUIElement(hudId, eyebrow, { name: 'Course Number', text: 'ROUTE 01  ·  SKY GARDEN', style: { color: '#B9FFF1', fontSize: '10px', fontWeight: '800' } });
  const title = store.addUIElement(hudId, brand, 'text');
  store.updateUIElement(hudId, title, { name: 'Course Name', text: 'CLOUDSTEP', style: { color: '#FFFFFF', fontSize: '23px', fontWeight: '800', textShadow: '0 3px 12px rgba(26,59,80,.35)' } });

  const statusPills = store.addUIElement(hudId, topBar, 'panel');
  store.updateUIElement(hudId, statusPills, {
    name: 'Player Status Pills',
    className: 'status-pills',
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px' },
  });

  const score = store.addUIElement(hudId, statusPills, 'panel');
  store.updateUIElement(hudId, score, {
    name: 'Sun Seed Counter',
    className: 'seed-pill',
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', padding: '11px 16px' },
  });
  const scoreText = store.addUIElement(hudId, score, 'text');
  store.updateUIElement(hudId, scoreText, { name: 'Sun Seed Total', text: '☀ 0 / 10', style: { color: '#FFF8D2', fontSize: '17px', fontWeight: '800', whiteSpace: 'nowrap' } });
  store.setUIBinding(hudId, scoreText, 'text', `'☀  ' + (Score / 10) + ' / 10'`);

  const hearts = store.addUIElement(hudId, statusPills, 'panel');
  store.updateUIElement(hudId, hearts, {
    name: 'Pip Heart Counter',
    className: 'life-pill',
    style: { display: 'flex', flexDirection: 'row', alignItems: 'center', padding: '11px 14px' },
  });
  const heartsText = store.addUIElement(hudId, hearts, 'text');
  store.updateUIElement(hudId, heartsText, {
    name: 'Pip Hearts',
    text: 'PIP  ♥  × 3',
    style: { color: '#FFD3DE', fontSize: '14px', fontWeight: '800', whiteSpace: 'nowrap' },
  });
  store.setUIBinding(hudId, heartsText, 'text', `'PIP  ♥  × ' + PipHearts`);

  const controls = store.addUIElement(hudId, hud.root.id, 'panel');
  store.updateUIElement(hudId, controls, {
    name: 'Controls',
    className: 'controls-pill',
    anchor: { h: 'center', v: 'bottom', offsetX: 18, offsetY: 20 },
    style: { display: 'flex', flexDirection: 'row', gap: '14px', padding: '9px 15px' },
  });
  store.setUIBinding(hudId, controls, 'visible', 'LevelComplete == false && FallOut == false');
  const controlsText = store.addUIElement(hudId, controls, 'text');
  store.updateUIElement(hudId, controlsText, {
    name: 'Controls Label',
    text: 'WASD  MOVE   ·   SPACE  JUMP   ·   SHIFT  DASH   ·   LMB  BOP',
    style: { color: '#E8FCFF', fontSize: '10px', fontWeight: '800', whiteSpace: 'nowrap' },
  });

  const checkpointChip = store.addUIElement(hudId, hud.root.id, 'text');
  store.updateUIElement(hudId, checkpointChip, {
    name: 'Checkpoint Reached',
    className: 'checkpoint-chip',
    text: '✓  SKY GARDEN CHECKPOINT',
    anchor: { h: 'center', v: 'top', offsetX: 18, offsetY: 24 },
    style: { color: '#173B4D', background: '#70F3D5', borderRadius: '999px', padding: '8px 14px', fontSize: '10px', fontWeight: '800' },
    animation: { type: 'pop', duration: 0.42 },
  });
  store.setUIBinding(hudId, checkpointChip, 'visible', 'Checkpoint >= 1 && LevelComplete == false && FallOut == false');

  const fallPanel = store.addUIElement(hudId, hud.root.id, 'panel');
  store.updateUIElement(hudId, fallPanel, {
    name: 'Pip Fall Out Card',
    className: 'fall-card',
    anchor: { h: 'center', v: 'middle', offsetX: 18, offsetY: 18 },
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px', padding: '25px 34px', textAlign: 'center' },
    animation: { type: 'pop', duration: 0.28 },
  });
  store.setUIBinding(hudId, fallPanel, 'visible', 'FallOut');
  const fallIcon = store.addUIElement(hudId, fallPanel, 'text');
  store.updateUIElement(hudId, fallIcon, {
    name: 'Pip Fall Out Icon',
    className: 'fall-icon',
    text: '☁  ✦  ☁',
    style: { color: '#FFF8D2', fontSize: '22px', fontWeight: '800' },
  });
  const fallTitle = store.addUIElement(hudId, fallPanel, 'text');
  store.updateUIElement(hudId, fallTitle, {
    name: 'Pip Fall Out Title',
    text: 'OH, PUFF!',
    style: { color: '#FFFFFF', fontSize: '32px', fontWeight: '800', textShadow: '0 4px 0 rgba(108,61,141,.22)' },
  });
  const fallHint = store.addUIElement(hudId, fallPanel, 'text');
  store.updateUIElement(hudId, fallHint, {
    name: 'Pip Fall Out Hint',
    text: 'Pip is catching the next cloud…',
    style: { color: '#244A62', fontSize: '12px', fontWeight: '700' },
  });

  const clearPanel = store.addUIElement(hudId, hud.root.id, 'panel');
  store.updateUIElement(hudId, clearPanel, {
    name: 'Course Clear Card',
    className: 'clear-card',
    anchor: { h: 'center', v: 'middle', offsetX: 18, offsetY: 18 },
    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '28px 38px', textAlign: 'center' },
    animation: { type: 'pop', duration: 0.5 },
  });
  store.setUIBinding(hudId, clearPanel, 'visible', 'LevelComplete');
  const clearConfetti = store.addUIElement(hudId, clearPanel, 'text');
  store.updateUIElement(hudId, clearConfetti, {
    name: 'Course Clear Confetti',
    className: 'clear-confetti',
    text: '✦  ●  ◆  ✦  ●  ✦',
    style: { color: '#FFF8D2', fontSize: '18px', fontWeight: '800', whiteSpace: 'nowrap' },
  });
  const clearKicker = store.addUIElement(hudId, clearPanel, 'text');
  store.updateUIElement(hudId, clearKicker, { name: 'Clear Kicker', text: '☀  SUNNY FOUND!', style: { color: '#6A4C12', fontSize: '11px', fontWeight: '800' } });
  const clearTitle = store.addUIElement(hudId, clearPanel, 'text');
  store.updateUIElement(hudId, clearTitle, { name: 'Clear Title', text: 'COURSE CLEAR!', style: { color: '#FFFFFF', fontSize: '38px', fontWeight: '800', textShadow: '0 4px 0 rgba(255,111,145,.35)' } });
  const clearScore = store.addUIElement(hudId, clearPanel, 'text');
  store.updateUIElement(hudId, clearScore, { name: 'Clear Score', text: 'SUN SEEDS  0 / 10', style: { color: '#173B4D', fontSize: '14px', fontWeight: '800' } });
  store.setUIBinding(hudId, clearScore, 'text', `'SUN SEEDS  ' + (Score / 10) + ' / 10'`);
  const clearHint = store.addUIElement(hudId, clearPanel, 'text');
  store.updateUIElement(hudId, clearHint, { name: 'Clear Hint', text: 'Keep exploring, or reshape the course in Edit mode.', style: { color: '#446779', fontSize: '11px', fontWeight: '600' } });

  store.setUIDocumentCss(
    hudId,
    [
      '@keyframes cloudstep-drift { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }',
      '@keyframes cloudstep-shine { 0% { transform: translateX(-140%) skewX(-18deg); } 70%,100% { transform: translateX(240%) skewX(-18deg); } }',
      '@keyframes cloudstep-confetti { 0%,100% { transform: translateY(0) rotate(-2deg) scale(.96); } 50% { transform: translateY(-6px) rotate(2deg) scale(1.06); } }',
      '@keyframes cloudstep-breathe { 0%,100% { filter: brightness(1); } 50% { filter: brightness(1.12); } }',
      '@keyframes cloudstep-tumble { 0%,100% { transform: rotate(-4deg) scale(.96); } 50% { transform: rotate(4deg) scale(1.08); } }',
      '@keyframes cloudstep-speed { 0% { transform: scale(1.02) rotate(-2deg); opacity: .42; } 100% { transform: scale(1.3) rotate(3deg); opacity: .7; } }',
      '.speed-lines {',
      '  pointer-events: none;',
      '  overflow: hidden;',
      '  background: repeating-conic-gradient(from 0deg at 50% 58%, transparent 0 5deg, rgba(255,255,220,.72) 5.5deg 6.5deg, transparent 7deg 14deg, rgba(112,243,213,.5) 14.5deg 15.2deg, transparent 16deg 22deg);',
      '  -webkit-mask-image: radial-gradient(circle at 50% 58%, transparent 0 22%, #000 47%, transparent 82%);',
      '  mask-image: radial-gradient(circle at 50% 58%, transparent 0 22%, #000 47%, transparent 82%);',
      '  mix-blend-mode: screen; transform-origin: 50% 58%; animation: cloudstep-speed .22s ease-in-out infinite alternate;',
      '}',
      '.course-card, .seed-pill, .life-pill, .controls-pill {',
      '  background: linear-gradient(145deg, rgba(25,68,88,.82), rgba(20,49,72,.7));',
      '  border: 1px solid rgba(255,255,255,.35);',
      '  box-shadow: inset 0 1px rgba(255,255,255,.32), 0 8px 24px rgba(24,65,82,.22);',
      '  backdrop-filter: blur(14px);',
      '  border-radius: 17px;',
      '}',
      '.seed-pill { animation: cloudstep-drift 3s ease-in-out infinite; }',
      '.life-pill { background: linear-gradient(145deg, rgba(111,47,82,.88), rgba(57,45,84,.78)); }',
      '.controls-pill { border-radius: 999px; }',
      '.checkpoint-chip { box-shadow: inset 0 1px rgba(255,255,255,.6), 0 7px 18px rgba(40,124,111,.24); animation: cloudstep-breathe 1.8s ease-in-out infinite; }',
      '.fall-icon { animation: cloudstep-tumble .48s ease-in-out infinite; letter-spacing: 6px; text-shadow: 0 4px 0 rgba(85,53,117,.18); }',
      '.fall-card {',
      '  position: relative;',
      '  overflow: hidden;',
      '  min-width: min(370px, calc(100vw - 36px));',
      '  background: linear-gradient(145deg, rgba(169,238,255,.97), rgba(184,145,255,.96) 56%, rgba(255,126,161,.95));',
      '  border: 2px solid rgba(255,255,255,.8);',
      '  border-radius: 26px;',
      '  box-shadow: inset 0 2px rgba(255,255,255,.55), 0 16px 54px rgba(40,50,100,.3);',
      '}',
      '.fall-card::before {',
      '  content: ""; position: absolute; inset: 0; pointer-events: none;',
      '  background: radial-gradient(circle at 18% 18%, rgba(255,255,255,.55) 0 3px, transparent 4px), radial-gradient(circle at 82% 28%, rgba(255,248,210,.6) 0 4px, transparent 5px);',
      '}',
      '.clear-confetti { animation: cloudstep-confetti .9s ease-in-out infinite; letter-spacing: 7px; text-shadow: 0 3px 0 rgba(255,111,145,.28); }',
      '.clear-card {',
      '  position: relative;',
      '  overflow: hidden;',
      '  min-width: min(430px, calc(100vw - 36px));',
      '  background: linear-gradient(145deg, rgba(255,242,169,.97), rgba(255,138,174,.96) 58%, rgba(86,220,199,.95));',
      '  border: 2px solid rgba(255,255,255,.78);',
      '  border-radius: 28px;',
      '  box-shadow: inset 0 2px rgba(255,255,255,.55), 0 16px 60px rgba(25,65,85,.32);',
      '}',
      '.clear-card::after {',
      '  content: ""; position: absolute; inset: -20% auto -20% 0; width: 32%;',
      '  background: linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent);',
      '  animation: cloudstep-shine 2.4s ease-in-out infinite; pointer-events: none;',
      '}',
      '@media (max-width: 640px) {',
      '  .top-bar { justify-content: flex-start !important; }',
      '  .course-card { padding: 10px 12px !important; }',
      '  .seed-pill { padding: 9px 12px !important; animation: none; }',
      '  .life-pill { padding: 9px 11px !important; }',
      '  .status-pills { gap: 6px !important; }',
      '  .controls-pill { display: none !important; }',
      '  .speed-lines { opacity: .58; }',
      '  .cloudstep-hud > div:has(> .clear-card), .cloudstep-hud > div:has(> .fall-card) { justify-content: flex-start !important; }',
      '  .clear-card, .fall-card { box-sizing: border-box; width: calc(100vw - 36px); min-width: 0; max-width: calc(100vw - 36px); padding: 24px 18px !important; gap: 6px !important; }',
      '}',
      '@media (prefers-reduced-motion: reduce) { .seed-pill, .checkpoint-chip, .fall-icon, .clear-confetti, .clear-card::after, .speed-lines { animation: none; } }',
    ].join('\n'),
  );

  store.selectObject(playerId);
  return playerId;
}
