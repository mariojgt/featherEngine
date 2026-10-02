import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { MaterialDefinition, ParticleSystemComponent, SceneObjectKind, UIElement, Vector3Tuple } from '../types';

/** Asset-free, portable starter. The game is ordinary scene objects, FeatherScript and bound UI. */
export async function createCubeRpgTemplate(): Promise<string> {
  const store = useEditorStore.getState();
  const sceneId = store.activeSceneId;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some((object) => object.id === id)) store.deleteObject(id);
  }
  store.renameScene(sceneId, 'Cube RPG — The Skyward Trials');
  store.applyRenderPreset(sceneId, 'stylized-nature');
  store.updateSceneEnvironment(sceneId, {
    skyMode: 'procedural', backgroundColor: '#94D7EE', skyTopColor: '#5EBEE8', skyHorizonColor: '#D1EEE8', skyGroundColor: '#B4DCE6',
    sunColor: '#FFE7B5', sunIntensity: 1.5, sunAzimuth: 135, sunElevation: 48,
    environmentIntensity: 1.1, fogEnabled: true, fogColor: '#C6E6EE', atmosphericFog: true, fogNear: 50, fogFar: 145,
    aerialFogEnabled: true, aerialFogHeightFalloff: 0.018, aerialFogInscatter: 0.1,
    aerialFogSunColor: '#FFF0CE', skyLighting: 'studio',
    wind: [1.2, 0, 0.4], windTurbulence: 0.2, dayCycleEnabled: false,
    toneMapping: 'agx', toneMappingExposure: 1.18, ambientMode: 'hemisphere', ambientIntensity: 0.95,
    contactShadows: true, contactShadowY: 0.1, contactShadowScale: 32,
    contactShadowOpacity: 0.28, contactShadowBlur: 2.5, contactShadowFar: 8, contactShadowColor: '#304F65',
  });
  store.updateRenderSettings({ quality: 'High', autoQuality: true, bloomEnabled: true,
    bloomIntensity: 0.35, bloomThreshold: 0.85, bloomRadius: 0.45, bloomMipmap: false, vignetteEnabled: true });
  const materials = store.createFolder('Cube RPG · Materials');
  const logic = store.createFolder('Cube RPG · Blueprints');
  const characters = store.createFolder('Cube RPG · Characters');
  const ui = store.createFolder('Cube RPG · UI');
  const mat = (name: string, color: string, patch: Partial<MaterialDefinition> = {}) => {
    const id = store.createMaterial(name, 'Editable stylized surface for the Skyward Trials.', materials);
    store.updateMaterial(id, { color, metalness: 0, roughness: 0.8, toon: true, toonFinish: 'jelly',
      toonBands: 3, toonRimColor: '#FFF5DA', toonRimStrength: 0.14, ...patch });
    return id;
  };
  const m = {
    mint: mat('Meadow · Pistachio', '#7ACDA0'), leaf: mat('Canopy · Jade', '#319F80', { toonFinish: 'cloth' }),
    stone: mat('Floating Rock · Slate', '#47667B', { toonFinish: 'rubber' }),
    cream: mat('Cloud & Marble · Pearl', '#FFF2D9', { toonFinish: 'pearl' }),
    coral: mat('Cubie · Tangerine', '#FBA06B'), ink: mat('Eyes & Soles · Ink', '#203748', { toonFinish: 'rubber' }),
    gold: mat('Equipment · Honey Gold', '#FFD26D', { emissiveColor: '#FFC760', emissiveIntensity: 0.12 }),
    silver: mat('Sword · Moon Silver', '#CEE7EA', { toonFinish: 'pearl' }),
    teal: mat('Shield · Lagoon', '#36B8B4'), violet: mat('Ruins · Lavender', '#B8A4DD'),
    purple: mat('Grumbles · Plum', '#9A70BB'), rose: mat('Flowers & Telegraphs · Rose', '#EC7C94'),
    glow: mat('Waystone · Sunlight', '#FFF2A8', { emissiveColor: '#FFD272', emissiveIntensity: 1.1 }),
    distant: mat('Distant Islands · Haze Blue', '#9CBFCC', { toonFinish: 'cloth' }),
  };
  const root = (name: string, parentId?: string, position: Vector3Tuple = [0, 0, 0]) =>
    store.createObjectWithProps('empty', { name, parentId, position });
  const world = root('Cube RPG — World');
  const arenas = root('01 · Arenas & Gates', world);
  const scenery = root('02 · Sky, Trees & Ruins', world);
  const fxRoot = root('03 · Editable VFX', world);
  const part = (name: string, position: Vector3Tuple, scale: Vector3Tuple, material: string,
    parentId = scenery, kind: Extract<SceneObjectKind, 'cube' | 'sphere' | 'capsule'> = 'cube', solid = false,
    rotation: Vector3Tuple = [0, 0, 0], trigger = false) => {
    const id = store.createObjectWithProps(kind, { name, position, parentId,
      physics: solid || trigger ? { enabled: true, bodyType: 'fixed', collider: kind === 'sphere' ? 'sphere' : 'box', friction: 0.9, isTrigger: trigger } : undefined });
    store.updateTransform(id, 'scale', scale);
    store.updateTransform(id, 'rotation', rotation);
    store.setObjectMaterial(id, material);
    return id;
  };
  const emitter = (name: string, color: string, position: Vector3Tuple, parentId = fxRoot,
    patch: Partial<ParticleSystemComponent> = {}) => {
    const id = root(name, parentId, position);
    store.addParticles(id, 'magic');
    store.updateParticles(id, { enabled: false, looping: false, rate: 0, burst: 0, maxParticles: 48,
      shape: 'sphere', shapeRadius: 0.35, speed: 2.2, speedJitter: 0.6, direction: [0, 1, 0],
      gravity: 1.8, drag: 0.4, lifetime: 0.65, startSize: 0.14, endSize: 0.01,
      startColor: color, endColor: '#FFF9DD', startOpacity: 0.9, endOpacity: 0,
      worldSpace: true, blend: 'additive', light: false, gpu: false, ...patch });
    return id;
  };
  const script = (id: string, name: string, description: string, source: string) => {
    const { blueprintId } = store.createBlueprintNamed(name, description, logic);
    const result = store.applyBlueprintFeatherSource(blueprintId, source);
    if (!result.ok) throw new Error(`${name}: ${result.diagnostics.map((d) => d.message).join('; ')}`);
    store.attachScript(id, blueprintId);
    return blueprintId;
  };
  let flashBlueprint: string | undefined;
  const damageFlash = (mesh: string, color: string) => {
    store.setObjectVariable(mesh, 'base_color', color);
    if (!flashBlueprint) {
      flashBlueprint = script(mesh, 'Combat · Per-Character Damage Flash',
        'A brief warm-white flash on this mesh only. Shared materials stay unchanged; the authored color returns after the hit.', `blueprint Damage_Flash
var base_color: string = "#FBA06B"
var flashing: boolean = false
on event CubeDamageFlash(payload):
    if self.flashing == false:
        self.flashing = true
        Material.set_color("base", "#FFF4CC")
        Material.set_color("emissive", "#FFD990")
        Material.set("emissiveIntensity", 0.8)
        wait(0.09)
        Material.set_color("base", self.base_color)
        Material.set_color("emissive", "#000000")
        Material.set("emissiveIntensity", 0)
        self.flashing = false
`);
    } else store.attachScript(mesh, flashBlueprint);
  };
  const defaults = {
    RpgHealth: 100, RpgPotions: 3, RpgArena: 1, RpgLevel: 1, RpgEnemies: 3, RpgCoins: 0,
    RpgStarted: false, RpgMenu: false, RpgDefeated: false, RpgVictory: false,
    RpgSword: true, RpgShield: true, RpgBlocking: false, RpgCombo: 0, RpgAttackGap: 0,
  };
  for (const [name, value] of Object.entries(defaults)) {
    const id = store.createVariable(name, typeof value === 'boolean' ? 'boolean' : 'number', false);
    store.updateVariable(id, { defaultValue: value });
  }
  const live = 'Game.RpgStarted and Game.RpgMenu == false and Game.RpgDefeated == false and Game.RpgVictory == false';

  // A compact route, with safe railings and two physical gates. Ornament colliders stay out of combat.
  const names = ['Petal Courtyard', 'Amethyst Keep', 'Sun Crown'];
  for (let a = 0; a < 3; a++) {
    const z = a * 36;
    const tint = [m.mint, m.violet, m.cream][a];
    const island = root(`Arena ${a + 1} · ${names[a]}`, arenas);
    part(`Arena ${a + 1} · Island Bedrock`, [0, -1.2, z], [27, 2.3, 27], m.stone, island, 'cube');
    part(`Arena ${a + 1} · Walkable Turf`, [0, -0.2, z], [26, 0.6, 26], tint, island, 'cube', true);
    part(`Arena ${a + 1} · Inlaid Combat Court`, [0, 0.11, z], [16, 0.04, 16], a === 1 ? m.cream : m.mint, island);
    for (const side of [-1, 1]) {
      part(`Arena ${a + 1} · ${side} Side Rail`, [side * 12.8, 0.55, z], [0.35, 1.4, 26], m.cream, island, 'cube', true);
      for (const end of [-1, 1]) {
        part(`Arena ${a + 1} · ${side}/${end} End Rail`, [side * 7.7, 0.55, z + end * 12.8], [10.2, 1.4, 0.35], m.cream, island, 'cube', true);
      }
    }
    for (let i = 0; i < 5; i++) {
      part(`Arena ${a + 1} · Hanging Rock ${i}`, [(i - 2) * 4.8, -4 - (i % 2), z],
        [5.5, 5.5 + (i % 2) * 2, 17], m.stone, island, 'sphere');
    }
    for (let r = 0; r < 8; r++) {
      const angle = r * Math.PI / 4;
      part(`Arena ${a + 1} · Court Rune ${r}`, [Math.sin(angle) * 6, 0.16, z + Math.cos(angle) * 6],
        [0.13, 1.5, 0.13], m.cream, island, 'capsule', false, [Math.PI / 2, angle + Math.PI / 2, 0]);
    }
    part(`Arena ${a + 1} · Court Emblem`, [0, 0.15, z], [1.6, 0.05, 1.6], m.gold, island, 'cube', false, [0, Math.PI / 4, 0]);
    for (let i = 0; i < 4; i++) {
      const x = i < 2 ? -10.3 : 10.3;
      const dz = i % 2 ? 8.8 : -8.8;
      if (a === 0) {
        part(`Meadow Tree ${i} · Trunk`, [x, 1.6, z + dz], [0.5, 3.2, 0.5], m.gold, scenery, 'capsule');
        part(`Meadow Tree ${i} · Crown`, [x, 3.8, z + dz], [3.7, 3.6, 3.3], m.leaf, scenery, 'sphere');
        part(`Meadow Tree ${i} · Crown Highlight`, [x - 0.65, 4.7, z + dz], [2.4, 2.5, 2.4], m.mint, scenery, 'sphere');
      } else {
        part(`Arena ${a + 1} · Pillar ${i}`, [x, 2, z + dz], [1, 4, 1], m.cream, scenery, 'cube');
        part(`Arena ${a + 1} · Pillar Cap ${i}`, [x, 4.1, z + dz], [1.55, 0.35, 1.55], m.gold);
        part(`Arena ${a + 1} · Crown Crystal ${i}`, [x, 4.8, z + dz], [0.8, 1.2, 0.8], a === 1 ? m.violet : m.glow,
          scenery, 'cube', false, [0, Math.PI / 4, Math.PI / 4]);
      }
      for (let f = 0; f < 3; f++) {
        part(`Arena ${a + 1} · Flower ${i}/${f}`, [x + (f - 1) * 0.8, 0.3, z + dz + 2], [0.4, 0.4, 0.4],
          f === 1 ? m.gold : m.rose, scenery, 'sphere');
      }
    }
    // A waypoint arch makes the route readable even without the HUD.
    for (const x of [-3, 3]) part(`Arena ${a + 1} · Arch ${x}`, [x, 2, z + 11.6], [0.7, 4, 0.7], m.cream);
    part(`Arena ${a + 1} · Arch Lintel`, [0, 4.1, z + 11.6], [6.8, 0.6, 0.7], m.gold);
    part(`Arena ${a + 1} · Waystone`, [0, 4.9, z + 11.6], [0.8, 0.8, 0.8], m.glow, scenery, 'cube', false, [0, 0, Math.PI / 4]);
    if (a < 2) {
      part(`Bridge ${a + 1} · Walkway`, [0, -0.2, z + 18], [5.5, 0.6, 10], m.cream, arenas, 'cube', true);
      for (const x of [-2.8, 2.8]) part(`Bridge ${a + 1} · Rail ${x}`, [x, 0.6, z + 18], [0.3, 1.5, 10], m.gold, arenas, 'cube', true);
    }
  }
  // Distant scenery is deliberately inexpensive: no imported textures, real-time lights or colliders.
  for (let i = 0; i < 7; i++) {
    const cloud = root(`Cloud Bank ${i}`, scenery, [i % 2 ? 25 : -27, -2 + (i % 3) * 3, i * 15 - 12]);
    for (let c = 0; c < 3; c++) part(`Cloud ${i} · Puff ${c}`, [(c - 1) * 4, c === 1 ? 1 : 0, 0],
      [7, c === 1 ? 4 : 2.6, 5], m.cream, cloud, 'sphere');
  }
  for (let i = 0; i < 5; i++) part(`Far Sky Island ${i}`, [(i % 2 ? 1 : -1) * (45 + i * 5), -10, 22 + i * 18],
    [15, 22, 15], m.distant, scenery, 'sphere');
  emitter('Meadow · Floating Pollen', '#FFE8A6', [0, 1, 0], fxRoot, {
    enabled: true, looping: true, gpu: true, shape: 'box', shapeRadius: 12, maxParticles: 64,
    rate: 6, speed: 0.25, gravity: -0.03, lifetime: 8, startSize: 0.06, endSize: 0.02,
  });

  const player = store.createRoleObject('player', { kind: 'empty', name: 'Cubie — Player Controller', position: [0, 0, 0] });
  if (!player.ok || !player.objectId) throw new Error('Could not create Cubie.');
  const hero = player.objectId;
  store.updateCharacterController(hero, {
    autoInputWithScript: true, stableJumpArc: true, moveSpeed: 5.4, sprintMultiplier: 1.45,
    jumpStrength: 7.5, gravity: 22, coyoteTime: 0.14, jumpBufferTime: 0.16,
    acceleration: 65, deceleration: 75, turnSpeed: 16, stepHeight: 0.3, groundSnap: 0.3,
    groundLevel: -18, mouseLook: false, cameraRelativeMovement: false, cameraFollow: true,
    cameraOffset: [7, 5, -11], cameraPitch: 0.4, cameraMinPitch: 0.4, cameraMaxPitch: 0.4,
    keyAttack: 'Unassigned', keyAim: 'Unassigned', keyRoll: 'Unassigned', keyRagdoll: 'Unassigned',
    lockOnEnabled: false, slideEnabled: false, mantleEnabled: false,
  });
  const rig = root('Cubie · Body Rig', hero);
  const heroBody = part('Cubie · Cube Body', [0, 0.95, 0], [1.2, 1.15, 1.05], m.coral, rig);
  damageFlash(heroBody, '#FBA06B');
  part('Cubie · Belt', [0, 0.54, 0], [1.23, 0.18, 1.08], m.teal, rig);
  part('Cubie · Belt Buckle', [0, 0.55, 0.56], [0.25, 0.23, 0.07], m.gold, rig);
  const eyes: string[] = [];
  const boots: string[] = [];
  for (const side of [-1, 1]) {
    const eye = root(`Cubie · ${side < 0 ? 'Left' : 'Right'} Eye Pivot`, rig, [side * 0.27, 1.16, 0.55]);
    eyes.push(eye);
    part(`Cubie · Eye White ${side}`, [0, 0, 0], [0.32, 0.4, 0.12], m.cream, eye, 'sphere');
    part(`Cubie · Pupil ${side}`, [0, 0, 0.065], [0.15, 0.23, 0.08], m.ink, eye, 'sphere');
    part(`Cubie · Eye Spark ${side}`, [0.035, 0.06, 0.107], [0.045, 0.06, 0.025], m.cream, eye, 'sphere');
    part(`Cubie · Blush ${side}`, [side * 0.47, 0.91, 0.54], [0.18, 0.1, 0.055], m.rose, rig, 'sphere');
    boots.push(part(`Cubie · Boot ${side}`, [side * 0.34, 0.18, 0.1], [0.45, 0.32, 0.6], m.ink, rig, 'sphere'));
    part(`Cubie · Glove ${side}`, [side * 0.8, 0.82, 0.07], [0.32, 0.32, 0.32], m.cream, rig, 'sphere');
  }
  part('Cubie · Smile', [0, 0.89, 0.55], [0.2, 0.055, 0.06], m.ink, rig, 'capsule', false, [0, 0, Math.PI / 2]);
  part('Cubie · Little Helmet', [0, 1.57, 0], [1.24, 0.19, 1.1], m.teal, rig);
  part('Cubie · Helmet Crest', [0, 1.81, -0.08], [0.19, 0.38, 0.7], m.gold, rig);
  const sword = root('Cubie · Sword Pivot', rig, [-0.85, 0.75, 0.15]);
  part('Sword · Grip', [0, 0.02, 0], [0.14, 0.35, 0.14], m.ink, sword);
  part('Sword · Guard', [0, 0.25, 0], [0.62, 0.12, 0.2], m.gold, sword);
  part('Sword · Blade', [0, 0.88, 0], [0.2, 1.15, 0.1], m.silver, sword);
  part('Sword · Tip', [0, 1.5, 0], [0.18, 0.24, 0.09], m.glow, sword, 'cube', false, [0, 0, Math.PI / 4]);
  const shield = root('Cubie · Shield Pivot', rig, [0.85, 0.9, 0.14]);
  part('Shield · Gold Rim', [0, 0, 0], [0.7, 0.88, 0.17], m.gold, shield, 'sphere');
  part('Shield · Teal Face', [0, 0, 0.1], [0.57, 0.73, 0.12], m.teal, shield, 'sphere');
  part('Shield · Star', [0, 0, 0.18], [0.2, 0.2, 0.06], m.cream, shield, 'cube', false, [0, 0, Math.PI / 4]);
  const slash = emitter('Cubie · Sword Sparks', '#FFE29B', [0, 0.8, 0.9], hero, { shape: 'disc', shapeRadius: 1.3, speed: 4, lifetime: 0.3 });
  const block = emitter('Cubie · Shield Burst', '#90F3ED', [0.7, 1, 0.3], hero);
  const heal = emitter('Cubie · Potion Hearts', '#8CF6B9', [0, 0.9, 0], hero, { gravity: -0.4, speed: 1, lifetime: 1 });
  const hurt = emitter('Cubie · Hurt Puff', '#FF9A9A', [0, 0.8, 0], hero, { blend: 'normal' });
  const finisherFx = emitter('Cubie · Finisher Whirl', '#FFD27A', [0, 0.7, 0], hero,
    { shape: 'disc', shapeRadius: 2.6, speed: 5.5, speedJitter: 1.4, lifetime: 0.38, startSize: 0.2, maxParticles: 72 });
  const slamFx = emitter('Cubie · Ground Slam Dust', '#FFF0C2', [0, 0.15, 0], hero,
    { shape: 'disc', shapeRadius: 1.2, direction: [0, 1, 0], speed: 6, speedJitter: 2, gravity: 9, lifetime: 0.55, startSize: 0.26, maxParticles: 80, blend: 'normal' });
  const shockwave = part('Cubie · Slam Shockwave', [0, 0.14, 0], [0.001, 0.001, 0.001], m.glow, hero, 'sphere');
  store.updateRenderer(shockwave, { opacity: 0.45 });
  script(shockwave, 'Combat · Shockwave Ring', 'A flat glowing ring that races outward from the finisher and the ground slam. Tune size and timing here.', `blueprint Shockwave_Ring
on event CubeShockwave(payload):
    set_scale(self, vec3(0.8, 0.05, 0.8))
    tween(self, property: "scale", to: vec3(7.4, 0.02, 7.4), duration: 0.24)
    wait(0.25)
    set_scale(self, vec3(0.001, 0.001, 0.001))
`);
  script(hero, 'Cubie · Equipment, Combat & Potions',
    'A buffered 3-hit sword combo (slash, backhand, spinning finisher), a jump-attack plunge that slams the ground, a shield that absorbs 75% damage, and potions that heal 45. Tune numbers here; all VFX are named child emitters.', `blueprint Cubie_Combat
var attack_ready: boolean = true
var hurt_ready: boolean = true
var impact_ready: boolean = true
var combo: number = 0
var combo_clock: number = 0
var queued: boolean = false
var queue_clock: number = 0
var plunging: boolean = false
var plunge_clock: number = 0
var air_ready: boolean = true
on key_pressed("Mouse0"):
    fire_event("CubeAttack")
on key_pressed("KeyJ"):
    fire_event("CubeAttack")
on event CubeAttack(payload):
    if ${live} and Game.RpgSword and Game.RpgBlocking == false and self.plunging == false:
        self.queued = true
        self.queue_clock = 0
on event CubeSwing(payload):
    self.combo = self.combo + 1
    Game.RpgCombo = self.combo
    if self.combo == 1:
        fire_event("CubieStrike", target: "${rig}")
        tween("${sword}", property: "rotation", to: vec3(0, 0, 28), duration: 0.05, space: "local")
        wait(0.06)
        burst_particles("${slash}", count: 24)
        tween("${sword}", property: "rotation", to: vec3(0, 0, -125), duration: 0.07, space: "local")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 2.8:
                apply_damage(actor, 26 + (Game.RpgLevel - 1) * 6)
        wait(0.2)
    elif self.combo == 2:
        fire_event("CubieStrike2", target: "${rig}")
        tween("${sword}", property: "rotation", to: vec3(0, 0, -150), duration: 0.04, space: "local")
        wait(0.05)
        burst_particles("${slash}", count: 30)
        tween("${sword}", property: "rotation", to: vec3(0, 0, 70), duration: 0.07, space: "local")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 2.8:
                apply_damage(actor, 30 + (Game.RpgLevel - 1) * 7)
        wait(0.2)
    else:
        fire_event("CubieFinisher", target: "${rig}")
        tween("${sword}", property: "rotation", to: vec3(0, 0, -95), duration: 0.06, space: "local")
        wait(0.11)
        burst_particles("${slash}", count: 40)
        burst_particles("${finisherFx}", count: 56)
        fire_event("CubeShockwave", target: "${shockwave}")
        Screen.flash(0.04, color: "#FFE7AE")
        for actor in find_actors(tag: "enemy"):
            if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 3.5:
                apply_damage(actor, 48 + (Game.RpgLevel - 1) * 11)
        wait(0.3)
    tween("${sword}", property: "rotation", to: vec3(0, 0, 0), duration: 0.14, space: "local")
    self.combo_clock = 0
    if self.combo >= 3:
        wait(0.22)
        self.combo = 0
        Game.RpgCombo = 0
    self.attack_ready = true
on event CubeAirAttack(payload):
    self.combo = 0
    Game.RpgCombo = 0
    self.air_ready = false
    fire_event("CubieAirSpin", target: "${rig}")
    apply_impulse(self, vec3(0, 3.2, 0))
    tween("${sword}", property: "rotation", to: vec3(0, 0, 165), duration: 0.12, space: "local")
    wait(0.16)
    apply_impulse(self, vec3(0, -26, 0))
    tween("${sword}", property: "rotation", to: vec3(0, 0, -115), duration: 0.08, space: "local")
    self.plunge_clock = 0
    self.plunging = true
on event CubeSlam(payload):
    fire_event("CubieLand", target: "${rig}")
    fire_event("CubeShockwave", target: "${shockwave}")
    burst_particles("${slamFx}", count: 60)
    Camera.shake(0.45)
    Screen.flash(0.05, color: "#FFE9B0")
    for actor in find_actors(tag: "enemy"):
        if get_var(actor, "arena") == Game.RpgArena and distance(position(self), position(actor)) < 3.8:
            apply_damage(actor, 42 + (Game.RpgLevel - 1) * 10)
    wait(0.16)
    tween("${sword}", property: "rotation", to: vec3(0, 0, 0), duration: 0.16, space: "local")
    wait(0.2)
    self.attack_ready = true
on event CubeImpact(payload):
    if ${live} and self.impact_ready:
        self.impact_ready = false
        Camera.shake(0.28)
        Camera.set(distance: 9.7, height: 4.7)
        Screen.flash(0.035, color: "#FFF0C6")
        wait(0.09)
        Camera.set(distance: 11, height: 5)
        wait(0.08)
        self.impact_ready = true
on key_pressed("Space"):
    if ${live} and self.is_grounded():
        fire_event("CubieJump", target: "${rig}")
on key_down("KeyQ"):
    if ${live} and Game.RpgShield:
        Game.RpgBlocking = true
on key_down("Mouse1"):
    if ${live} and Game.RpgShield:
        Game.RpgBlocking = true
on key_up("KeyQ"):
    Game.RpgBlocking = false
on key_up("Mouse1"):
    Game.RpgBlocking = false
on event CubeBlock(payload):
    if ${live} and Game.RpgShield:
        Game.RpgBlocking = true
        wait(0.8)
        Game.RpgBlocking = false
on key_pressed("Digit1"):
    fire_event("CubeSword")
on key_pressed("Digit2"):
    fire_event("CubeShield")
on event CubeSword(payload):
    if ${live}:
        Game.RpgSword = not Game.RpgSword
on event CubeShield(payload):
    if ${live}:
        Game.RpgShield = not Game.RpgShield
        Game.RpgBlocking = false
on key_pressed("KeyE"):
    fire_event("CubePotion")
on key_pressed("Digit3"):
    fire_event("CubePotion")
on event CubePotion(payload):
    if ${live} and Game.RpgPotions > 0 and Game.RpgHealth < 100:
        Game.RpgPotions = Game.RpgPotions - 1
        Game.RpgHealth = clamp(Game.RpgHealth + 45, 0, 100)
        burst_particles("${heal}", count: 26)
        Screen.flash(0.06, color: "#9EF4CB")
on receive_damage(amount):
    if ${live} and self.hurt_ready:
        self.hurt_ready = false
        if Game.RpgBlocking and Game.RpgShield:
            Game.RpgHealth = clamp(Game.RpgHealth - amount * 0.25, 0, 100)
            burst_particles("${block}", count: 24)
            Camera.shake(0.14)
            fire_event("CubieGuard", target: "${rig}")
        else:
            Game.RpgHealth = clamp(Game.RpgHealth - amount, 0, 100)
            burst_particles("${hurt}", count: 18)
            Camera.shake(0.1)
            fire_event("CubieHurt", target: "${rig}")
            fire_event("CubeDamageFlash", target: "${heroBody}")
        if Game.RpgHealth <= 0:
            Game.RpgDefeated = true
            Game.RpgBlocking = false
            Time.scale = 0
        wait(0.35)
        self.hurt_ready = true
on update(dt):
    if Game.RpgSword:
        set_scale("${sword}", vec3(1, 1, 1))
    else:
        set_scale("${sword}", vec3(0.001, 0.001, 0.001))
    if Game.RpgShield:
        set_scale("${shield}", vec3(1, 1, 1))
    else:
        set_scale("${shield}", vec3(0.001, 0.001, 0.001))
    if Game.RpgBlocking:
        set_rotation("${shield}", vec3(-12, -30, -15))
    else:
        set_rotation("${shield}", vec3(0, 0, 0))
    if self.attack_ready and self.combo > 0:
        self.combo_clock = self.combo_clock + dt
        if self.combo_clock > 0.6:
            self.combo = 0
            Game.RpgCombo = 0
    if self.queued:
        self.queue_clock = self.queue_clock + dt
        if self.queue_clock > 0.45:
            self.queued = false
    if self.queued and self.attack_ready and ${live} and Game.RpgSword and Game.RpgBlocking == false:
        self.queued = false
        self.attack_ready = false
        if self.is_grounded() == false and self.air_ready:
            fire_event("CubeAirAttack", target: self)
        else:
            fire_event("CubeSwing", target: self)
    if self.plunging:
        self.plunge_clock = self.plunge_clock + dt
        if self.is_grounded():
            self.plunging = false
            fire_event("CubeSlam", target: self)
        elif self.plunge_clock > 1.6:
            self.plunging = false
            self.attack_ready = true
            fire_event("CubieLand", target: "${rig}")
    if self.air_ready == false and self.plunging == false and self.is_grounded():
        self.air_ready = true
on event CubeFall(payload):
    if ${live}:
        self.plunging = false
        self.queued = false
        self.attack_ready = true
        Game.RpgHealth = clamp(Game.RpgHealth - 20, 0, 100)
        set_position(self, vec3(0, 2, (Game.RpgArena - 1) * 36 - 7))
        if Game.RpgHealth <= 0:
            Game.RpgDefeated = true
            Time.scale = 0
`);
  script(rig, 'Cubie · Walk, Strike & Expressions', 'A real foot stride, body sway, jump stretch, sword follow-through, guard brace and hurt squint. All poses stay on the visual rig.', `blueprint Cubie_Motion
var phase: number = 0
var pose: string = "idle"
on update(dt):
    self.phase = self.phase + dt * 12
    if self.pose != "hurt" and self.pose != "blink":
        set_scale("${eyes[0]}", vec3(1, 1, 1))
        set_scale("${eyes[1]}", vec3(1, 1, 1))
    if self.pose == "idle":
        if speed("${hero}") > 0.6:
            set_position(self, vec3(0, abs(sin(self.phase)) * 0.11, 0))
            set_rotation(self, vec3(3, 0, sin(self.phase) * 5))
            set_position("${boots[0]}", vec3(-0.34, 0.18 + max(0, sin(self.phase)) * 0.12, 0.1 + sin(self.phase) * 0.2))
            set_position("${boots[1]}", vec3(0.34, 0.18 + max(0, (0 - sin(self.phase))) * 0.12, 0.1 - sin(self.phase) * 0.2))
            set_rotation("${boots[0]}", vec3(sin(self.phase) * 25, 0, 0))
            set_rotation("${boots[1]}", vec3((0 - sin(self.phase)) * 25, 0, 0))
        else:
            set_position(self, vec3(0, 0.035 + sin(self.phase * 0.25) * 0.025, 0))
            set_rotation(self, vec3(0, 0, sin(self.phase * 0.25) * 1.5))
            set_position("${boots[0]}", vec3(-0.34, 0.18, 0.1))
            set_position("${boots[1]}", vec3(0.34, 0.18, 0.1))
            set_rotation("${boots[0]}", vec3(0, 0, 0))
            set_rotation("${boots[1]}", vec3(0, 0, 0))
on event CubieStrike(payload):
    self.pose = "strike"
    tween(self, property: "rotation", to: vec3(-8, 0, 12), duration: 0.05)
    tween(self, property: "scale", to: vec3(1.1, 0.88, 1.08), duration: 0.05)
    wait(0.06)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(10, 0, -14), duration: 0.07)
        tween(self, property: "scale", to: vec3(0.95, 1.1, 0.95), duration: 0.07)
    wait(0.1)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.16)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.16)
    wait(0.17)
    if self.pose == "strike":
        self.pose = "idle"
on event CubieStrike2(payload):
    self.pose = "strike"
    tween(self, property: "rotation", to: vec3(-6, 0, -14), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.08, 0.9, 1.08), duration: 0.04)
    wait(0.05)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(12, 0, 16), duration: 0.07)
        tween(self, property: "scale", to: vec3(0.94, 1.12, 0.94), duration: 0.07)
    wait(0.1)
    if self.pose == "strike":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.15)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.15)
    wait(0.16)
    if self.pose == "strike":
        self.pose = "idle"
on event CubieFinisher(payload):
    self.pose = "finisher"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(1.14, 0.84, 1.14), duration: 0.06)
    wait(0.06)
    tween(self, property: "position", to: vec3(0, 0.45, 0), duration: 0.12)
    tween(self, property: "rotation", to: vec3(0, 360, 0), duration: 0.24)
    tween(self, property: "scale", to: vec3(0.92, 1.14, 0.92), duration: 0.1)
    wait(0.14)
    if self.pose == "finisher":
        tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.1)
    wait(0.11)
    if self.pose == "finisher":
        set_rotation(self, vec3(0, 0, 0))
        tween(self, property: "scale", to: vec3(1.12, 0.86, 1.12), duration: 0.05)
        wait(0.06)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.14)
        wait(0.15)
        if self.pose == "finisher":
            self.pose = "idle"
on event CubieAirSpin(payload):
    self.pose = "air"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(0.86, 0.86, 0.86), duration: 0.06)
    tween(self, property: "rotation", to: vec3(360, 0, 0), duration: 0.18)
    wait(0.19)
    if self.pose == "air":
        set_rotation(self, vec3(18, 0, 0))
        tween(self, property: "scale", to: vec3(0.9, 1.2, 0.9), duration: 0.06)
on event CubieLand(payload):
    self.pose = "land"
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "scale", to: vec3(1.32, 0.66, 1.32), duration: 0.04)
    tween(self, property: "position", to: vec3(0, -0.08, 0), duration: 0.04)
    wait(0.12)
    if self.pose == "land":
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.18)
        tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.18)
    wait(0.19)
    if self.pose == "land":
        self.pose = "idle"
on event CubieJump(payload):
    if self.pose == "idle":
        self.pose = "jump"
        tween(self, property: "scale", to: vec3(0.9, 1.18, 0.9), duration: 0.07)
        wait(0.12)
        if self.pose == "jump":
            tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.13)
        wait(0.14)
        if self.pose == "jump":
            self.pose = "idle"
on event CubieGuard(payload):
    self.pose = "guard"
    tween(self, property: "rotation", to: vec3(-10, 0, -5), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.08, 0.91, 1.08), duration: 0.04)
    wait(0.1)
    if self.pose == "guard":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.14)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.14)
    wait(0.15)
    if self.pose == "guard":
        self.pose = "idle"
on event CubieHurt(payload):
    self.pose = "hurt"
    set_scale("${eyes[0]}", vec3(1, 0.25, 1))
    set_scale("${eyes[1]}", vec3(1, 0.25, 1))
    tween(self, property: "rotation", to: vec3(-16, 0, 10), duration: 0.04)
    tween(self, property: "scale", to: vec3(1.16, 0.8, 1.12), duration: 0.04)
    wait(0.1)
    if self.pose == "hurt":
        tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.18)
        tween(self, property: "scale", to: vec3(1, 1, 1), duration: 0.18)
    wait(0.19)
    if self.pose == "hurt":
        set_scale("${eyes[0]}", vec3(1, 1, 1))
        set_scale("${eyes[1]}", vec3(1, 1, 1))
        self.pose = "idle"
on timer(3):
    if self.pose == "idle":
        self.pose = "blink"
        set_scale("${eyes[0]}", vec3(1, 0.08, 1))
        set_scale("${eyes[1]}", vec3(1, 0.08, 1))
        wait(0.12)
        if self.pose == "blink":
            set_scale("${eyes[0]}", vec3(1, 1, 1))
            set_scale("${eyes[1]}", vec3(1, 1, 1))
            self.pose = "idle"
`);
  const heroPrefab = store.createPrefabFromObject(hero, 'Cubie · Playable Cube Knight', characters);
  if (!heroPrefab) throw new Error('Could not create the reusable cube knight.');
  store.updateTransform(hero, 'position', [0, 1.2, -7]);
  store.updateTransform(hero, 'rotation', [0, Math.PI, 0]);

  const fall = part('Cloud Sea · Recovery Trigger', [0, -6, 36], [100, 2, 150], m.cream, arenas, 'cube', false, [0, 0, 0], true);
  store.updateRenderer(fall, { enabled: false });
  script(fall, 'Cube RPG · Fall Recovery', 'Falling costs 20 health and returns Cubie to the current arena.', `blueprint Fall_Recovery
on trigger_enter(other: "${hero}"):
    fire_event("CubeFall", target: Player)
`);

  const enemyBlueprintOwner = root('04 · Arena Opponents', world);
  const enemyBlueprint = store.createBlueprintNamed('Grumble · Chase, Telegraph & Loot',
    'One reusable AI: arena gates activation; each foe keeps its own jittered attack clock and a shared 0.8s attack token (RpgAttackGap) stops two foes committing on the same beat. A pink warning commits the attack: light hits cannot cancel it, only damage at or above poise (combo finisher, ground slam). Per-instance hp, damage, speed, poise, attack rate and arena are Inspector-editable.', logic).blueprintId;
  const source = `blueprint Grumble_AI
var hp: number = 56
var max_hp: number = 56
var arena: number = 1
var damage: number = 16
var pace: number = 2
var defeated: boolean = false
var reacting: boolean = false
var attacking: boolean = false
var recoil: number = 3.4
var knock: number = 1
var poise: number = 40
var attack_rate: number = 1.7
var attack_clock: number = 0
var windup: number = 0
var rig_anchor: string = ""
var mesh_anchor: string = ""
var impact_anchor: string = ""
var vfx_anchor: string = ""
var tell_anchor: string = ""
var health_anchor: string = ""
var warning_anchor: string = ""
on start:
    set_visible(self.warning_anchor, false)
    set_scale(self.warning_anchor, vec3(4.6, 0.03, 4.6))
    self.attack_clock = random(0, self.attack_rate * 0.7)
on update(dt):
    set_scale(self.health_anchor, vec3(clamp(self.hp / self.max_hp, 0, 1), 1, 1))
    if ${live} and Game.RpgArena == self.arena and self.defeated == false:
        if self.reacting:
            self.move_to(Player.location, speed: 0 - self.recoil * self.knock, arrival: 0.2)
        elif self.attacking:
            self.move_to(Player.location, speed: 0, arrival: 1.3)
            self.windup = self.windup - dt
            if self.windup <= 0:
                self.attacking = false
                set_visible(self.warning_anchor, false)
                if distance(position(self), Player.location) < 2.7:
                    fire_event("GrumbleStrike", target: self.rig_anchor)
                    apply_damage(Player, self.damage)
        else:
            self.move_to(Player.location, speed: self.pace, arrival: 1.3)
            if distance(position(self), Player.location) < 3.2:
                self.attack_clock = self.attack_clock + dt
                if self.attack_clock >= self.attack_rate and Game.RpgAttackGap <= 0 and distance(position(self), Player.location) < 2.5:
                    Game.RpgAttackGap = 0.8
                    self.attack_clock = random(0, 0.5)
                    self.attacking = true
                    fire_event("GrumbleAttack", target: self)
on event GrumbleAttack(payload):
    self.windup = 0.42
    fire_event("GrumbleWindup", target: self.rig_anchor)
    set_position(self.tell_anchor, position(self))
    set_visible(self.warning_anchor, true)
    burst_particles(self.tell_anchor, count: 14)
on receive_damage(amount):
    if ${live} and Game.RpgArena == self.arena and self.defeated == false:
        self.hp = self.hp - amount
        set_position(self.vfx_anchor, vec_add(position(self), vec3(0, 0.7, 0)))
        burst_particles(self.vfx_anchor, count: 26)
        fire_event("CubeHitVfx", target: self.impact_anchor)
        fire_event("CubeImpact", target: Player)
        if self.attacking and amount < self.poise and self.hp > 0:
            fire_event("CubeDamageFlash", target: self.mesh_anchor)
        else:
            self.knock = clamp(amount / 30, 0.7, 2.4)
            self.reacting = true
            self.attacking = false
            self.attack_clock = 0
            set_visible(self.warning_anchor, false)
            fire_event("GrumbleHit", target: self.rig_anchor)
        if self.hp <= 0:
            self.defeated = true
            wait(0.26)
            burst_particles(self.vfx_anchor, count: 28)
            Game.RpgEnemies = clamp(Game.RpgEnemies - 1, 0, 10)
            Game.RpgCoins = Game.RpgCoins + 10 * self.arena
            destroy(self)
`;
  const compiled = store.applyBlueprintFeatherSource(enemyBlueprint, source);
  if (!compiled.ok) throw new Error(`Grumble AI: ${compiled.diagnostics.map((d) => d.message).join('; ')}`);
  const spots: Vector3Tuple[][] = [ [[-4, 0.1, 2], [4, 0.1, 3], [0, 0.1, 7]],
    [[-4, 0.1, 38], [4, 0.1, 39], [0, 0.1, 43]], [[0, 0.1, 76]] ];
  let motionBlueprint: string | undefined;
  let impactBlueprint: string | undefined;
  for (let a = 0; a < 3; a++) {
    for (let e = 0; e < spots[a].length; e++) {
      const boss = a === 2;
      const name = boss ? 'Sun Crown · King Grumble' : `Arena ${a + 1} · Grumble ${e + 1}`;
      const foe = root(name, enemyBlueprintOwner, spots[a][e]);
      store.setObjectVariable(foe, 'enemy', true);
      store.setObjectVariable(foe, 'enemySpeed', 0);
      store.setObjectVariable(foe, 'chaseRange', 0);
      for (const [key, value] of Object.entries({ hp: boss ? 252 : a ? 84 : 56, max_hp: boss ? 252 : a ? 84 : 56, arena: a + 1, damage: boss ? 32 : a ? 24 : 16, pace: boss ? 1.65 : a ? 2.5 : 2 })) {
        store.setObjectVariable(foe, key, value);
      }
      const body = root(`${name} · Toy Rig`, foe);
      if (boss) store.updateTransform(body, 'scale', [1.65, 1.65, 1.65]);
      const bodyMesh = part(`${name} · Body`, [0, 0.72, 0], [1.1, 1.15, 1.1], boss ? m.rose : m.purple, body);
      damageFlash(bodyMesh, boss ? '#EC7C94' : '#9A70BB');
      const eyePivots: string[] = [], brows: string[] = [], feet: string[] = [];
      for (const side of [-1, 1]) {
        const eye = root(`${name} · Eye Pivot ${side}`, body, [side * 0.24, 0.94, 0.56]);
        eyePivots.push(eye);
        part(`${name} · Eye ${side}`, [0, 0, 0], [0.22, 0.28, 0.09], m.cream, eye, 'sphere');
        part(`${name} · Pupil ${side}`, [0, 0, 0.05], [0.1, 0.17, 0.07], m.ink, eye, 'sphere');
        brows.push(part(`${name} · Brow ${side}`, [side * 0.24, 1.16, 0.57], [0.32, 0.07, 0.08], m.ink, body, 'cube', false, [0, 0, -side * 0.25]));
        feet.push(part(`${name} · Foot ${side}`, [side * 0.32, 0.14, 0.08], [0.42, 0.24, 0.52], m.ink, body, 'sphere'));
      }
      const mouth = root(`${name} · Hurt Mouth Pivot`, body, [0, 0.65, 0.58]);
      store.updateTransform(mouth, 'scale', [0.001, 0.001, 0.001]);
      part(`${name} · Hurt Mouth`, [0, 0, 0], [0.21, 0.25, 0.08], m.ink, mouth, 'sphere');
      if (boss) {
        part('King Grumble · Crown Band', [0, 1.37, 0], [1.25, 0.22, 1.25], m.gold, body);
        for (let c = -1; c <= 1; c++) part(`King Grumble · Crown Point ${c}`, [c * 0.4, 1.66, 0], [0.2, 0.45, 0.3], m.glow, body);
      }
      const barY = boss ? 2.2 : 1.6;
      part(`${name} · Health Track`, [0, barY, 0], [1.25, 0.1, 0.18], m.ink, body);
      const healthBar = root(`${name} · Health Fill Pivot`, body, [-0.6, barY, 0]);
      part(`${name} · Health Fill`, [0.6, 0.035, -0.04], [1.2, 0.075, 0.2], m.rose, healthBar);
      store.setObjectVariable(foe, 'health_anchor', healthBar);
      for (const [key, value] of Object.entries({ owner: foe, mesh_anchor: bodyMesh, eye_left: eyePivots[0], eye_right: eyePivots[1],
        brow_left: brows[0], brow_right: brows[1], foot_left: feet[0], foot_right: feet[1], mouth_anchor: mouth, base_scale: boss ? 1.65 : 1 })) {
        store.setObjectVariable(body, key, value);
      }
      if (!motionBlueprint) {
        motionBlueprint = script(body, 'Grumble · Motion & Hit Reactions',
          'Walk, wind-up, lunge, recoil, squint and a defeat pop. Named instance anchors make the same poses work on every foe, including the larger boss.', `blueprint Grumble_Motion
var owner: string = ""
var mesh_anchor: string = ""
var eye_left: string = ""
var eye_right: string = ""
var brow_left: string = ""
var brow_right: string = ""
var foot_left: string = ""
var foot_right: string = ""
var mouth_anchor: string = ""
var base_scale: number = 1
var phase: number = 0
var pose: string = "idle"
on update(dt):
    self.phase = self.phase + dt * 11
    if self.pose == "idle":
        if ${live} and get_var(self.owner, "arena") == Game.RpgArena and distance(position(self.owner), Player.location) > 1.4:
            set_position(self, vec3(0, abs(sin(self.phase)) * 0.12, 0))
            set_rotation(self, vec3(4, 0, sin(self.phase) * 7))
            set_position(self.foot_left, vec3(-0.32, 0.14 + max(0, sin(self.phase)) * 0.14, 0.08 + sin(self.phase) * 0.22))
            set_position(self.foot_right, vec3(0.32, 0.14 + max(0, (0 - sin(self.phase))) * 0.14, 0.08 - sin(self.phase) * 0.22))
            set_rotation(self.foot_left, vec3(sin(self.phase) * 30, 0, 0))
            set_rotation(self.foot_right, vec3((0 - sin(self.phase)) * 30, 0, 0))
        else:
            set_position(self, vec3(0, 0.04 + sin(self.phase * 0.3) * 0.03, 0))
            set_rotation(self, vec3(0, 0, sin(self.phase * 0.3) * 2))
            set_position(self.foot_left, vec3(-0.32, 0.14, 0.08))
            set_position(self.foot_right, vec3(0.32, 0.14, 0.08))
            set_rotation(self.foot_left, vec3(0, 0, 0))
            set_rotation(self.foot_right, vec3(0, 0, 0))
on event GrumbleWindup(payload):
    if self.pose != "hurt" and self.pose != "defeat":
        self.pose = "windup"
        tween(self, property: "rotation", to: vec3(-18, 0, 0), duration: 0.12)
        tween(self, property: "scale", to: vec3(self.base_scale * 1.12, self.base_scale * 0.82, self.base_scale * 1.12), duration: 0.12)
        wait(0.38)
        if self.pose == "windup":
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.12)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.12)
            wait(0.13)
            if self.pose == "windup":
                self.pose = "idle"
on event GrumbleStrike(payload):
    if self.pose != "hurt" and self.pose != "defeat":
        self.pose = "strike"
        tween(self, property: "position", to: vec3(0, 0.05, 0.3), duration: 0.06)
        tween(self, property: "rotation", to: vec3(24, 0, 0), duration: 0.06)
        tween(self, property: "scale", to: vec3(self.base_scale * 0.92, self.base_scale * 1.1, self.base_scale * 0.92), duration: 0.06)
        wait(0.08)
        if self.pose == "strike":
            tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.14)
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.14)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.14)
        wait(0.15)
        if self.pose == "strike":
            self.pose = "idle"
on event GrumbleHit(payload):
    if self.pose != "defeat" and (self.pose != "hurt" or get_var(self.owner, "defeated")):
        self.pose = "hurt"
        fire_event("CubeDamageFlash", target: self.mesh_anchor)
        set_scale(self.eye_left, vec3(1, 0.22, 1))
        set_scale(self.eye_right, vec3(1, 0.22, 1))
        set_scale(self.mouth_anchor, vec3(1, 1, 1))
        set_rotation(self.brow_left, vec3(0, 0, -28))
        set_rotation(self.brow_right, vec3(0, 0, 28))
        tween(self, property: "position", to: vec3(0, 0.12, -0.28), duration: 0.05)
        tween(self, property: "rotation", to: vec3(-22, 0, 9), duration: 0.05)
        tween(self, property: "scale", to: vec3(self.base_scale * 1.25, self.base_scale * 0.7, self.base_scale * 1.15), duration: 0.05)
        wait(0.07)
        if get_var(self.owner, "defeated"):
            self.pose = "defeat"
            tween(self, property: "rotation", to: vec3(-80, 0, 20), duration: 0.16)
            tween(self, property: "scale", to: vec3(0.001, 0.001, 0.001), duration: 0.16)
        else:
            tween(self, property: "position", to: vec3(0, 0, 0), duration: 0.16)
            tween(self, property: "rotation", to: vec3(0, 0, 0), duration: 0.16)
            tween(self, property: "scale", to: vec3(self.base_scale, self.base_scale, self.base_scale), duration: 0.16)
            wait(0.17)
            if get_var(self.owner, "defeated") == false:
                set_scale(self.eye_left, vec3(1, 1, 1))
                set_scale(self.eye_right, vec3(1, 1, 1))
                set_scale(self.mouth_anchor, vec3(0.001, 0.001, 0.001))
                set_rotation(self.brow_left, vec3(0, 0, 14.32))
                set_rotation(self.brow_right, vec3(0, 0, -14.32))
                set_var(self.owner, "reacting", false)
                self.pose = "idle"
`);
      } else store.attachScript(body, motionBlueprint);
      const impact = emitter(`${name} · Loot & Hit Sparks`, '#FFF0B8', [0, 0, 0], fxRoot,
        { speed: 4, speedJitter: 1.2, lifetime: 0.4, startSize: 0.2, maxParticles: 72 });
      const star = root(`${name} · Impact Star`, impact);
      store.updateTransform(star, 'scale', [0.001, 0.001, 0.001]);
      for (const angle of [-Math.PI / 4, Math.PI / 4]) {
        part(`${name} · Impact Streak ${angle < 0 ? 'A' : 'B'}`, [0, 0, 0], [1.6, 0.12, 0.12], m.glow, star, 'cube', false, [0, 0, angle]);
      }
      if (!impactBlueprint) {
        impactBlueprint = script(star, 'Combat · Impact Star', 'An editable bright cross that snaps on at contact, spins and disappears in 0.18 seconds.', `blueprint Impact_Star
on event CubeHitVfx(payload):
    set_scale(self, vec3(1, 1, 1))
    set_rotation(self, vec3(0, 0, 0))
    tween(self, property: "rotation", to: vec3(0, 0, 75), duration: 0.18)
    tween(self, property: "scale", to: vec3(0.001, 0.001, 0.001), duration: 0.18)
`);
      } else store.attachScript(star, impactBlueprint);
      const tell = emitter(`${name} · Attack Warning`, '#FF7080', [0, 0, 0], fxRoot,
        { shape: 'disc', shapeRadius: 2.3, direction: [0, 1, 0], speed: 0.15, gravity: 0, startSize: 0.17, lifetime: 0.35, blend: 'normal' });
      const warning = part(`${name} · Danger Disc`, [0, 0.05, 0], [0.001, 0.001, 0.001], m.rose, tell, 'sphere');
      store.updateRenderer(warning, { opacity: 0.28 });
      store.setObjectVariable(foe, 'warning_anchor', warning);
      store.setObjectVariable(foe, 'rig_anchor', body);
      store.setObjectVariable(foe, 'mesh_anchor', bodyMesh);
      store.setObjectVariable(foe, 'impact_anchor', star);
      store.setObjectVariable(foe, 'recoil', boss ? 1.8 : 3.4);
      store.setObjectVariable(foe, 'poise', boss ? 999 : 40);
      store.setObjectVariable(foe, 'attack_rate', boss ? 1.5 : a ? 1.6 : 1.9);
      store.setObjectVariable(foe, 'vfx_anchor', impact);
      store.setObjectVariable(foe, 'tell_anchor', tell);
      store.attachScript(foe, enemyBlueprint);
    }
  }
  for (let a = 0; a < 2; a++) {
    const z = a * 36 + 14;
    const gate = part(`Arena ${a + 1} · Locked Gate`, [0, 1.5, z], [5.2, 3.2, 0.45], m.teal, arenas, 'cube', true);
    const gateFX = emitter(`Arena ${a + 1} · Gate Unlock Celebration`, '#FFDF8E', [0, 1.5, z]);
    script(gate, `Arena ${a + 1} · Gate Unlock`, 'The physical gate lifts once all enemies in this arena are defeated.', `blueprint Gate_Unlock
var opened: boolean = false
on update(dt):
    if Game.RpgArena == ${a + 1} and Game.RpgEnemies == 0 and self.opened == false:
        self.opened = true
        set_physics(self, { enabled: false })
        tween(self, property: "position", to: vec3(0, 6.5, ${z}), duration: 0.7)
        burst_particles("${gateFX}", count: 32)
`);
    const portal = part(`Arena ${a + 2} · Entry Trigger`, [0, 1.5, z + 9], [5.2, 4, 2], m.glow, arenas, 'cube', false, [0, 0, 0], true);
    store.updateRenderer(portal, { enabled: false });
    script(portal, `Arena ${a + 2} · Level Up`, 'Enter the next arena only after clearing this one. Gain a level, two potions and 20 health.', `blueprint Arena_Entry
on trigger_enter(other: "${hero}"):
    if ${live} and Game.RpgArena == ${a + 1} and Game.RpgEnemies == 0:
        Game.RpgArena = ${a + 2}
        Game.RpgLevel = ${a + 2}
        Game.RpgEnemies = ${a === 0 ? 3 : 1}
        Game.RpgPotions = Game.RpgPotions + 2
        Game.RpgHealth = clamp(Game.RpgHealth + 20, 0, 100)
        burst_particles("${heal}", count: 32)
`);
  }
  const victoryFX = emitter('Sun Crown · Victory Confetti', '#FFDE76', [0, 2, 72], fxRoot, { lifetime: 2, speed: 4, maxParticles: 64 });
  const flow = root('05 · Start, Pause, Retry & Victory', world);
  script(flow, 'Cube RPG · Game Flow', 'Start and pause stop game time. Replay reloads the complete authored scene and resets every run variable.', `blueprint Cube_RPG_Flow
on start:
    if Game.RpgStarted == false:
        Game.RpgMenu = true
        Time.scale = 0
on event CubeResume(payload):
    if Game.RpgDefeated == false and Game.RpgVictory == false:
        Game.RpgStarted = true
        Game.RpgMenu = false
        Game.RpgBlocking = false
        Time.scale = 1
on event CubePause(payload):
    if Game.RpgStarted and Game.RpgDefeated == false and Game.RpgVictory == false:
        Game.RpgMenu = true
        Game.RpgBlocking = false
        Time.scale = 0
on key_pressed("KeyP"):
    if Game.RpgDefeated == false and Game.RpgVictory == false:
        if Game.RpgMenu:
            fire_event("CubeResume")
        else:
            fire_event("CubePause")
on event CubeRestart(payload):
${Object.entries(defaults).map(([name, value]) => `    Game.${name} = ${name === 'RpgStarted' ? 'true' : String(value)}`).join('\n')}
    Time.scale = 1
    Scene.load("${sceneId}")
on update(dt):
    if Game.RpgAttackGap > 0:
        Game.RpgAttackGap = max(0, Game.RpgAttackGap - dt)
    if ${live} and Game.RpgArena == 3 and Game.RpgEnemies == 0:
        burst_particles("${victoryFX}", count: 64)
        Game.RpgVictory = true
        Game.RpgBlocking = false
        Time.scale = 0
`);

  const hudId = store.createUIDocument('Cube RPG · Adventure HUD', 'screen', ui);
  store.updateUIDocument(hudId, { visibleOnStart: true, renderMode: 'dom' });
  store.attachUI(world, hudId);
  const hud = useEditorStore.getState().uiDocuments.find((d) => d.id === hudId)!;
  store.updateUIElement(hudId, hud.root.id, { name: 'Cube RPG HUD Root', className: 'cube-rpg-hud',
    anchor: { h: 'stretch', v: 'stretch', offsetX: 0, offsetY: 0 }, style: { width: '100%', height: '100%', padding: '0', display: 'block' } });
  const element = (parent: string, type: UIElement['kind'], name: string, patch: Partial<UIElement>) => {
    const id = store.addUIElement(hudId, parent, type);
    store.updateUIElement(hudId, id, { name,
      ...(type === 'button' ? { style: { background: patch.className?.includes('rpg-primary') ? '#FFD478' : '#F7FAEF',
        color: '#2D525A', padding: '11px 15px', borderRadius: '12px', fontWeight: '800', fontSize: '13px' } } : {}),
      ...patch });
    return id;
  };
  const bind = (id: string, target: 'text' | 'visible', expression: string) => store.setUIBinding(hudId, id, target, expression);
  const top = element(hud.root.id, 'panel', 'Adventure Status', { className: 'rpg-top', anchor: { h: 'left', v: 'top', offsetX: 20, offsetY: 20 },
    style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px 20px', width: '300px' } });
  element(top, 'text', 'Game Brand', { text: 'CUBE RPG', css: 'letter-spacing: 3px;', style: { fontSize: '11px', fontWeight: '800', color: '#51727E' } });
  const arenaTitle = element(top, 'text', 'Arena Name', { text: names[0], style: { fontSize: '24px', fontWeight: '900', color: '#233E4A' } });
  bind(arenaTitle, 'text', "RpgArena == 1 ? 'Petal Courtyard' : (RpgArena == 2 ? 'Amethyst Keep' : 'Sun Crown')");
  const stats = element(top, 'text', 'Health & Level', { text: '♥ 100 / 100  ·  LV 1', style: { fontSize: '15px', color: '#A34E4D', fontWeight: '800' } });
  bind(stats, 'text', "'♥ ' + RpgHealth + ' / 100   ·   LV ' + RpgLevel");
  const objective = element(top, 'text', 'Arena Objective', { style: { fontSize: '13px', color: '#476C77', whiteSpace: 'normal' } });
  bind(objective, 'text', "RpgEnemies > 0 ? ('Defeat ' + RpgEnemies + ' grumbles to open the gate') : 'Arena clear! Follow the golden arch →'");
  const coins = element(top, 'text', 'Loot Total', { style: { fontSize: '12px', color: '#8C701F' } });
  bind(coins, 'text', "'✦ ' + RpgCoins + ' gold   ·   ARENA ' + RpgArena + ' / 3'");
  const combo = element(hud.root.id, 'text', 'Combo Counter', { text: 'COMBO ×2', className: 'rpg-combo',
    anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: -150 }, style: { fontSize: '30px', fontWeight: '900', color: '#FFF6D8' } });
  bind(combo, 'text', "RpgCombo >= 3 ? 'FINISHER!' : ('COMBO ×' + RpgCombo)");
  bind(combo, 'visible', 'RpgCombo >= 2 && RpgMenu == false && RpgDefeated == false && RpgVictory == false');
  const actions = element(hud.root.id, 'panel', 'Equipment & Abilities', { className: 'rpg-actions', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 24 },
    style: { display: 'flex', gap: '8px', padding: '10px', alignItems: 'stretch', maxWidth: '94%' } });
  bind(actions, 'visible', 'RpgStarted && RpgMenu == false && RpgDefeated == false && RpgVictory == false');
  for (const [name, text, event, binding] of [
    ['Sword Equipment', 'Sword · 1', 'CubeSword', "RpgSword ? '⚔ Sword · 1' : 'Equip sword · 1'"],
    ['Shield Equipment', 'Shield · 2', 'CubeShield', "RpgShield ? '◈ Shield · 2' : 'Equip shield · 2'"],
    ['Attack Ability', 'Slash · J', 'CubeAttack', "RpgCombo > 0 ? ('⚔ Combo ' + RpgCombo + ' / 3') : 'Slash · J'"],
    ['Block Ability', 'Block · Q', 'CubeBlock', "RpgBlocking ? '◈ Blocking' : 'Block · Q'"],
    ['Potion Ability', 'Potion · E', 'CubePotion', "'✚ ' + RpgPotions + ' potions · E'"],
  ]) {
    const id = element(actions, 'button', name, { text, onClickEvent: event, className: 'rpg-button rpg-ability' });
    if (binding) bind(id, 'text', binding);
  }
  const hints = element(hud.root.id, 'text', 'Movement Controls', { text: 'WASD move · SPACE jump · click / J ×3 combo · jump + click to slam · hold Q / right click to block',
    className: 'rpg-hints', anchor: { h: 'center', v: 'bottom', offsetX: 0, offsetY: 92 }, style: { color: '#234855', fontSize: '12px', textAlign: 'center', maxWidth: '85%', whiteSpace: 'normal' } });
  bind(hints, 'visible', 'RpgMenu == false && RpgDefeated == false && RpgVictory == false');
  const pause = element(hud.root.id, 'button', 'Pause Game', { text: 'Pause · P', onClickEvent: 'CubePause', className: 'rpg-button', anchor: { h: 'right', v: 'top', offsetX: 20, offsetY: 20 } });
  bind(pause, 'visible', 'RpgStarted && RpgMenu == false && RpgDefeated == false && RpgVictory == false');
  const menu = element(hud.root.id, 'panel', 'Start & Pause Menu', { className: 'rpg-menu', anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 },
    style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '32px', width: '410px', maxWidth: '90%', alignItems: 'stretch', textAlign: 'center' } });
  bind(menu, 'visible', 'RpgMenu && RpgDefeated == false && RpgVictory == false');
  element(menu, 'text', 'Menu Eyebrow', { text: 'THE SKYWARD TRIALS', css: 'letter-spacing: 3px;', style: { fontSize: '11px', fontWeight: '800', color: '#638079' } });
  const title = element(menu, 'text', 'Menu Title', { text: 'Little cube. Big adventure.', css: 'line-height: 1.06;', style: { fontSize: '38px', fontWeight: '900', whiteSpace: 'normal', color: '#233E4A' } });
  bind(title, 'text', "RpgStarted ? 'Take a breather.' : 'Little cube. Big adventure.'");
  element(menu, 'text', 'How to Play', { text: 'Chain three slashes into a spinning finisher, or jump and attack to slam the ground. A pink warning means a grumble is committed: block, step away, or break it with a finisher or slam. Potions heal 45 health.', css: 'line-height: 1.6;', style: { fontSize: '14px', whiteSpace: 'normal', color: '#4C6B76' } });
  element(menu, 'text', 'Menu Controls', { text: 'WASD move · Space jump · Shift sprint\nClick / J ×3 combo · Jump + click ground slam\nHold Q / right click block · E / 3 potion · P pause', css: 'line-height: 1.7; white-space: pre-line;', style: { fontSize: '12px', color: '#527178' } });
  const resume = element(menu, 'button', 'Start or Resume', { text: 'Begin adventure →', onClickEvent: 'CubeResume', className: 'rpg-button rpg-primary' });
  bind(resume, 'text', "RpgStarted ? 'Resume adventure →' : 'Begin adventure →'");
  const restart = element(menu, 'button', 'Restart Run', { text: 'Restart from arena 1', onClickEvent: 'CubeRestart', className: 'rpg-button' });
  bind(restart, 'visible', 'RpgStarted');
  for (const won of [false, true]) {
    const panel = element(hud.root.id, 'panel', won ? 'Victory Menu' : 'Defeat Menu', { className: 'rpg-menu', anchor: { h: 'center', v: 'middle', offsetX: 0, offsetY: 0 },
      style: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '32px', width: '380px', maxWidth: '90%', textAlign: 'center' } });
    bind(panel, 'visible', won ? 'RpgVictory' : 'RpgDefeated');
    element(panel, 'text', won ? 'Victory Title' : 'Defeat Title', { text: won ? 'The crown is yours!' : 'A brave little cube.', style: { fontSize: '30px', fontWeight: '900', color: '#233E4A' } });
    const message = element(panel, 'text', won ? 'Victory Loot' : 'Retry Hint', { text: 'Try holding your shield when the pink sparks appear. Save a potion for King Grumble.', css: 'line-height: 1.6;', style: { fontSize: '14px', color: '#527178', whiteSpace: 'normal' } });
    if (won) bind(message, 'text', "'Three arenas conquered · Level ' + RpgLevel + ' · ' + RpgCoins + ' gold collected'");
    element(panel, 'button', won ? 'Play Again' : 'Try Again', { text: won ? 'Play again →' : 'Try again →', onClickEvent: 'CubeRestart', className: 'rpg-button rpg-primary' });
  }
  store.updateUIDocument(hudId, { css: `
.cube-rpg-hud { font-family: ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; }
.rpg-top, .rpg-actions { background: rgba(255,249,232,.94); border: 1px solid rgba(255,255,255,.95); border-radius: 18px; box-shadow: 0 8px 28px rgba(30,66,77,.15); }
.rpg-menu { background: linear-gradient(145deg,#fff9e8,#e2f3e7); border: 2px solid #fffdf0; border-radius: 26px; box-shadow: 0 24px 80px rgba(27,57,70,.3); pointer-events: auto; z-index: 20; }
.rpg-button { border: 1px solid #e0e8d9; border-radius: 12px; padding: 11px 15px; color: #2d525a; background: #f7faef; font-weight: 800; font-size: 13px; cursor: pointer; pointer-events: auto; box-shadow: 0 3px 0 rgba(42,83,87,.1); }
.rpg-button:hover { background: #fff0c9; transform: translateY(-1px); }
.rpg-button:focus-visible { outline: 3px solid #327F91; outline-offset: 3px; }
.rpg-primary { background: #ffd478; border-color: #f4c363; color: #5c491f; padding: 14px 18px; }
.rpg-combo { text-shadow: 0 3px 0 #C2683F, 0 6px 18px rgba(80,40,20,.45); letter-spacing: 2px; animation: rpg-combo-pop .18s ease-out; }
@keyframes rpg-combo-pop { from { transform: scale(1.35); opacity: .4; } to { transform: scale(1); opacity: 1; } }
.rpg-hints { background: rgba(255,249,232,.82); border-radius: 20px; padding: 7px 14px; }
@media (max-width: 640px) { .rpg-top { width: 240px !important; box-sizing: border-box; padding: 10px 14px !important; } .rpg-ability { padding: 9px 8px !important; font-size: 11px !important; } .rpg-actions { gap: 4px !important; padding: 6px !important; flex-wrap: wrap; justify-content: center; bottom: 154px !important; } .rpg-hints { display: none !important; } .rpg-menu { padding: 22px !important; } }
@media (prefers-reduced-motion: reduce) { .rpg-button { transform: none !important; transition: none !important; } .rpg-combo { animation: none !important; } }
` });
  store.selectObject(hero);
  return hero;
}
