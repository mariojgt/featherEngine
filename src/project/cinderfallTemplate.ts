import { defaultCharacter, selectActiveObjects, useEditorStore } from '../store/editorStore';
import { mapActiveSceneObjects } from '../store/editor/storeHelpers';
import type { LightComponent, MaterialDefinition, ModelSpec, SceneObject, SceneObjectKind, Vector3Tuple } from '../types';
import { addCinderfallUI } from '../creator/cinderfallUI';
import { cinderfallAudio } from './cinderfallAudio';
import { cinderfallModelDefinitions } from './cinderfallArt';

export const CINDERFALL_QUOTA = 16;
export const CINDERFALL_VEINS: Vector3Tuple[] = [[-6.2, 0.55, -1], [6.8, 0.55, 10], [-6, 0.55, 24], [6.2, 0.55, 37], [-2, 0.55, 45]];
export const CINDERFALL_CREATURES: Vector3Tuple[] = [[-3, 0.1, 17], [4.5, 0.1, 22], [-5, 0.1, 31], [4, 0.1, 39], [-8.5, 0.1, 8], [8, 0.1, 18], [-6, 0.1, 43], [5, 0.1, 47]];

/**
 * One complete original mining/extraction FPS. All art is editable Model Forge or primitive data;
 * every gameplay rule compiles into normal FeatherScript/Blueprints and ships in the project package.
 */
export async function createCinderfallTemplate(): Promise<string> {
  const s = useEditorStore.getState(), sceneId = s.activeSceneId;
  for (const id of ['obj-player', 'obj-ground', 'obj-enemy', 'obj-light', 'obj-camera']) {
    if (selectActiveObjects(useEditorStore.getState()).some(object => object.id === id)) s.deleteObject(id);
  }
  s.renameScene(sceneId, 'Cinderfall · Sector 07');
  s.updateSceneEnvironment(sceneId, {
    skyMode: 'color', backgroundColor: '#08131b', environmentIntensity: 0.72,
    ambientMode: 'hemisphere', ambientIntensity: 0.32,
    sunColor: '#9cb8c9', sunIntensity: 0.7, sunAzimuth: 220, sunElevation: 42,
    fogEnabled: true, fogColor: '#0c2029', fogNear: 12, fogFar: 70,
    toneMapping: 'agx', toneMappingExposure: 1.1, wind: [0.3, 0, 0.2],
    gravity: [0, -9.81, 0], contactShadows: false,
  });
  s.updateRenderSettings({ quality: 'High', autoQuality: true, bloomEnabled: true, bloomIntensity: 0.32, bloomThreshold: 1, bloomRadius: 0.5, vignetteEnabled: true });
  const art = s.createFolder('Cinderfall · Original materials'), logic = s.createFolder('Cinderfall · Editable gameplay');
  const prefabs = s.createFolder('Cinderfall · Reusable field equipment'), audioFolder = s.createFolder('Cinderfall · Original synthesized audio');
  const audio = cinderfallAudio();
  s.addAssetItems(Object.values(audio).map(asset => ({ ...asset, folderId: audioFolder })));
  s.setSceneAudio(sceneId, { ambientSoundId: audio.ambient.id });
  const patch = (id: string, values: Partial<SceneObject>) => useEditorStore.setState(state => mapActiveSceneObjects(state, objects => objects.map(object => object.id === id ? { ...object, ...values } : object)));
  const material = (name: string, color: string, values: Partial<MaterialDefinition> = {}) => {
    const id = s.createMaterial(name, 'Original Cinderfall surface.', art);
    s.updateMaterial(id, { color, roughness: 0.78, metalness: 0.05, ...values }); return id;
  };
  const m = {
    floor: material('Basalt dust', '#303d49'), dark: material('Rig graphite', '#1d2c35', { roughness: 0.48, metalness: 0.65 }),
    yellow: material('Survey ochre', '#bd9141', { roughness: 0.55, metalness: 0.28 }), steel: material('Brushed field alloy', '#708b91', { roughness: 0.35, metalness: 0.7 }),
    lamp: material('Amber work lights', '#fff0bb', { emissiveColor: '#ffd482', emissiveIntensity: 2.5 }),
    teal: material('Aetherite glow', '#66d9bc', { emissiveColor: '#40d2b7', emissiveIntensity: 1.6 }),
    coral: material('Hazard marks', '#d67045'), moss: material('Cave lichen', '#37594f'),
  };
  const primitive = (name: string, p: Vector3Tuple, scale: Vector3Tuple, mat: string, kind: SceneObjectKind = 'cube', parent?: string, solid = false, rotation?: Vector3Tuple) => {
    const id = s.createObjectWithProps(kind, { name, position: p, parentId: parent, ...(solid ? { physics: { enabled: true, bodyType: 'fixed', collider: kind === 'sphere' ? 'sphere' : 'box', isTrigger: false, friction: 0.85 } } : {}) });
    s.updateTransform(id, 'scale', scale); if (rotation) s.updateTransform(id, 'rotation', rotation);
    if (kind !== 'empty' && kind !== 'light') s.setObjectMaterial(id, mat); return id;
  };
  const root = (name: string, p: Vector3Tuple = [0, 0, 0], parent?: string) => primitive(name, p, [1, 1, 1], m.dark, 'empty', parent);
  const light = (name: string, p: Vector3Tuple, color: string, intensity: number, distance: number, parent?: string) => {
    const id = root(name, p, parent);
    const component: LightComponent = { type: 'point', color, intensity, distance, castShadow: false, angle: Math.PI / 5 };
    patch(id, { kind: 'light', light: component }); return id;
  };
  const compile = (name: string, description: string, source: string) => {
    const { blueprintId } = s.createBlueprintNamed(name, description, logic);
    const result = s.applyBlueprintFeatherSource(blueprintId, source.trim());
    if (!result.ok || result.diagnostics.length) throw new Error(`${name}: ${result.diagnostics.map(d => d.message).join('; ')}`);
    return blueprintId;
  };
  const definitions = cinderfallModelDefinitions(), specs = new Map<string, string>();
  for (const definition of definitions) {
    const id = s.createModelSpec('blank', definition.name);
    if (!id) throw new Error(`Could not create ${definition.name}.`);
    s.updateModelSpec(id, definition as Partial<ModelSpec>); specs.set(definition.name, id);
  }
  const model = (name: string, spec: string, p: Vector3Tuple, scale: Vector3Tuple = [1, 1, 1], parent?: string, rotation?: Vector3Tuple) => {
    const id = s.createModelFromSpec(specs.get(`Cinderfall · ${spec}`)!, { position: p, name });
    if (!id) throw new Error(`Could not place ${name}.`);
    if (parent) { s.setObjectParent(id, parent); s.updateTransform(id, 'position', p); }
    s.updateTransform(id, 'scale', scale); if (rotation) s.updateTransform(id, 'rotation', rotation); return id;
  };
  const globals: [string, 'number' | 'boolean' | 'string', number | boolean | string][] = [
    ['CFStage', 'number', 0], ['CFStarted', 'boolean', false], ['CFPaused', 'boolean', false], ['CFOre', 'number', 0], ['CFQuota', 'number', CINDERFALL_QUOTA],
    ['CFSeconds', 'number', 0], ['CFDisplaySeconds', 'number', 0], ['CFTimeLeft', 'number', 75], ['CFAmmo', 'number', 24], ['CFReload', 'number', 0], ['CFKills', 'number', 0],
    ['CFHeadlamp', 'boolean', true], ['CFToast', 'string', ''], ['CFToastTime', 'number', 0], ['CFPrompt', 'string', 'Find a glowing aetherite vein'], ['CFHint', 'string', 'WASD move · Shift sprint · P pause'], ['Health', 'number', 100],
  ];
  for (const [name, type, defaultValue] of globals) { const id = s.createVariable(name, type, false); s.updateVariable(id, { defaultValue }); }

  const world = root('Cinderfall · Authored cave'), rock = root('01 · Basalt cavern', [0, 0, 0], world);
  const equipment = root('02 · Survey infrastructure', [0, 0, 0], world), veins = root('03 · Aetherite seams', [0, 0, 0], world), creatures = root('04 · Cavewardens', [0, 0, 0], world);
  primitive('Continuous cave floor', [0, -0.35, 15], [27, 0.7, 72], m.floor, 'cube', rock, true);
  primitive('West cave collision', [-13.5, 3, 15], [1.3, 6, 72], m.floor, 'cube', rock, true);
  primitive('East cave collision', [13.5, 3, 15], [1.3, 6, 72], m.floor, 'cube', rock, true);
  primitive('Far cave collision', [0, 3, 50], [27, 6, 1.4], m.floor, 'cube', rock, true);
  primitive('Rig bay collision', [0, 3, -20], [27, 6, 1.4], m.floor, 'cube', rock, true);
  // Repeated faceted meshes overlap into a continuous cave silhouette around a clear walkable route.
  for (let i = 0; i < 15; i++) {
    const z = -19 + i * 4.8;
    for (const side of [-1, 1]) {
      const x = side * (11.2 + Math.sin(i * 1.7) * 0.8);
      model(`Basalt wall ${side < 0 ? 'W' : 'E'}${i + 1}`, `Basalt ${i % 3 + 1}`, [x, 2.3, z], [5.4, 7.5 + Math.sin(i) * 1.3, 6.8], rock, [0.12, i * 0.71, side * 0.13]);
      model(`Basalt roof haunch ${side < 0 ? 'W' : 'E'}${i + 1}`, `Basalt ${(i + 1) % 3 + 1}`, [side * 6.8, 6.8, z], [8.5, 3.4, 6.8], rock, [0, i * 0.37, side * 0.35]);
    }
  }
  for (let i = 0; i < 12; i++) model(`Roof ridge ${i + 1}`, `Basalt ${i % 3 + 1}`, [Math.sin(i) * 1.7, 8.3, -17 + i * 6], [8.5, 3.3, 7.4], rock, [0.12, i, 0.1]);
  for (let i = 0; i < 24; i++) {
    const side = i % 2 ? -1 : 1, z = -14 + i * 2.7;
    model(`Floor scree ${i + 1}`, `Basalt ${i % 3 + 1}`, [side * (8.8 + Math.sin(i * 2) * 1.1), 0.15, z], [0.7 + i % 3 * 0.2, 0.4, 1.1], rock, [0.1, i * 0.9, 0]);
    if (i % 3 === 0) primitive(`Lichen patch ${i + 1}`, [side * 10.4, 0.08, z], [2, 0.09, 1], m.moss, 'sphere', rock);
  }
  // Mid-cave buttresses create two sightline changes without narrow corridors or invisible collision.
  for (const [index, x, z] of [[1, -6.8, 12], [2, 6.4, 28]] as const) {
    model(`Basalt buttress ${index}`, 'Basalt 2', [x, 2.35, z], [4.8, 6.8, 5], rock);
    primitive(`Buttress ${index} collision`, [x, 2, z], [2.7, 4, 3.2], m.floor, 'cube', rock, true);
  }
  const rig = root('Amber extraction rig', [0, 0, -16], equipment);
  primitive('Rig footing', [0, 0.08, 0], [5.6, 0.16, 4.2], m.dark, 'cube', rig);
  primitive('Cargo hatch', [0, 0.19, 0], [3.7, 0.14, 2.8], m.steel, 'cube', rig);
  for (const side of [-1, 1]) {
    primitive(`Rig support ${side}`, [side * 2.25, 1.5, 1], [0.65, 3, 0.7], m.yellow, 'cube', rig);
    primitive(`Rig tower rail ${side}`, [side * 2.58, 1.5, 1], [0.14, 3.3, 0.3], m.steel, 'cube', rig);
    primitive(`Rig inset lamp ${side}`, [side * 2.25, 1.8, 0.57], [0.38, 0.2, 0.05], m.lamp, 'cube', rig);
  }
  primitive('Rig canopy', [0, 3, 1], [5.4, 0.65, 1.9], m.yellow, 'cube', rig);
  primitive('Rig signal mast', [-2.7, 2.65, 0], [0.12, 5.3, 0.12], m.steel, 'cube', rig);
  primitive('Rig signal bulb', [-2.7, 5.4, 0], [0.35, 0.35, 0.35], m.lamp, 'sphere', rig);
  for (let i = 0; i < 5; i++) primitive(`Hatch chevron ${i + 1}`, [-1.55 + i * 0.76, 0.275, 0], [0.4, 0.015, 2.4], i % 2 ? m.dark : m.yellow, 'cube', rig, false, [0, -0.2, 0]);
  light('Rig floodlight', [0, 3.4, -1.2], '#ffd9a1', 35, 15, rig);
  for (let i = 0; i < 6; i++) {
    const z = -9 + i * 9, x = i % 2 ? -8.6 : 8.6;
    const beacon = root(`Survey beacon ${i + 1}`, [x, 0, z], equipment);
    primitive('Beacon pole', [0, 0.75, 0], [0.11, 1.5, 0.11], m.steel, 'cube', beacon);
    primitive('Beacon housing', [0, 1.58, 0], [0.4, 0.18, 0.35], m.yellow, 'cube', beacon);
    primitive('Beacon light', [0, 1.51, 0], [0.21, 0.07, 0.25], m.lamp, 'cube', beacon);
    light('Warm survey pool', [0, 2.1, 0], '#ffd196', 23, 16, beacon);
  }
  for (const [i, x, z] of [[1, -4, -9], [2, 5, 4], [3, -3, 30]] as const) {
    const crate = root(`Field cargo ${i}`, [x, 0, z], equipment);
    primitive('Reinforced cargo case', [0, 0.55, 0], [1.3, 1.1, 1], m.dark, 'cube', crate, true);
    primitive('Cargo ochre cover', [0, 1.16, 0], [1.4, 0.16, 1.1], m.yellow, 'cube', crate);
    primitive('Cargo latch', [0, 0.76, -0.52], [0.22, 0.3, 0.05], m.steel, 'cube', crate);
    s.createPrefabFromObject(crate, `Cinderfall · Field cargo ${i}`, prefabs);
  }
  s.createPrefabFromObject(rig, 'Cinderfall · Extraction rig', prefabs);

  const player = s.createRoleObject('player', { kind: 'empty', name: 'Surveyor · First-person pawn', position: [0, 0.05, -12] });
  if (!player.ok || !player.objectId) throw new Error('Could not create the surveyor.');
  const playerId = player.objectId;
  s.updateCharacterController(playerId, {
    cameraMode: 'firstPerson', cameraFollow: true, mouseLook: true, autoInputWithScript: false,
    cameraOffset: [0, 1.68, 0], cameraPitch: 0, cameraMinPitch: -1.25, cameraMaxPitch: 1.25,
    moveSpeed: 5.2, sprintMultiplier: 1.45, acceleration: 32, deceleration: 38, jumpStrength: 5.7, gravity: 18, stepHeight: 0.35,
    keyAttack: 'Unbound', keyReload: 'Unbound', keyRoll: 'Unbound', keyEmote: 'Unbound', keyCrouch: 'KeyC',
    footstepSoundId: audio.step.id, hurtSoundId: audio.hurt.id, groundLevel: -4,
  });
  s.setObjectVariable(playerId, 'health', 100);
  const lamp = light('Surveyor headlamp', [0, 1.6, 0.2], '#d5f4e7', 14, 16, playerId);
  const weapon = model('VX-24 · Editable camera weapon', 'VX-24 Survey Rifle', [0.28, -0.34, -0.52]);
  patch(weapon, { viewModel: { ownerObjectId: playerId } });
  s.attachScript(weapon, compile('Cinderfall · Weapon presentation', 'Recoil and a real reload dip. The camera weapon is a live-linked Model Forge asset.', `blueprint Cinderfall_Weapon
var kick: number = 0
on event CFShot(payload):
    self.kick = 0.07
on update(dt):
    self.kick = max(0, self.kick - dt * 0.65)
    set_position(self, vec3(0.28, -0.34 + self.kick * 0.4 - min(Game.CFReload, 0.28), -0.52 + self.kick))
    set_rotation(self, vec3(0 - min(Game.CFReload, 0.28) * 45, 0, self.kick * -25))`));

  const playerBlueprint = compile('Cinderfall · Surveyor controller', 'Ground movement, bounded magazine, timed reload, headlamp and pause. Tune walk_speed, fire_interval and reload_seconds here.', `blueprint Cinderfall_Surveyor
var walk_speed: number = 5.2
var fire_interval: number = 0.14
var reload_seconds: number = 1.25
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and Game.Health > 0:
        self.move(Input.move(), speed: self.walk_speed)
        if Game.CFReload > 0:
            Game.CFReload = max(0, Game.CFReload - dt)
            if Game.CFReload <= 0:
                Game.CFAmmo = 24
on key_down("Mouse0"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and Game.Health > 0:
        if Game.CFReload <= 0 and Game.CFAmmo > 0:
            if cooldown(self.fire_interval):
                Game.CFAmmo = Game.CFAmmo - 1
                spawn_projectile(speed: 115, damage: 28)
                Audio.play("${audio.shot.id}")
                Camera.shake(0.05)
                fire_event("CFShot")
on key_pressed("KeyR"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        if Game.CFAmmo < 24 and Game.CFReload <= 0:
            Game.CFReload = self.reload_seconds
            Audio.play("${audio.reload.id}")
on key_pressed("Space"):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        self.jump()
on key_pressed("KeyF"):
    if Game.CFStage > 0 and Game.CFStage < 3:
        if Game.CFHeadlamp:
            Game.CFHeadlamp = false
            set_visible("${lamp}", false)
        else:
            Game.CFHeadlamp = true
            set_visible("${lamp}", true)`);
  s.attachScript(playerId, playerBlueprint);
  // The shared projectile node exposes all engine projectile tuning in the graph inspector.
  const playerGraph = useEditorStore.getState().graphs.find(graph => graph.id === useEditorStore.getState().blueprints.find(bp => bp.id === playerBlueprint)!.graphId)!;
  for (const node of playerGraph.nodes.filter(node => node.data.nodeKind === 'action.spawnProjectile')) s.updateGraphNodeData(node.id, { projectileSize: 0.075, projectileColor: '#ffd391', projectileLife: 1.2, projectileKnockback: 0.45, projectileMuzzle: [0.28, -0.29, 1.1] });

  const mineBlueprint = compile('Cinderfall · Aetherite mining', 'Hold E within 2.8 metres. Each vein yields four units; quota stops mining at sixteen.', `blueprint Cinderfall_Aetherite
var remaining: number = 4
on key_down("KeyE"):
    if Game.CFStage == 1 and Game.CFPaused == false and self.remaining > 0:
        if distance(position(self), Player.location) < 2.8:
            if cooldown(0.35):
                self.remaining = self.remaining - 1
                Game.CFOre = min(Game.CFQuota, Game.CFOre + 1)
                Audio.play("${audio.mine.id}")
                Camera.shake(0.035)
                if self.remaining <= 0:
                    set_visible(self, false)
                else:
                    set_scale(self, vec3(0.65 + self.remaining * 0.09, 0.6 + self.remaining * 0.1, 0.65 + self.remaining * 0.09))`);
  for (const [index, p] of CINDERFALL_VEINS.entries()) {
    const vein = model(`Aetherite vein ${index + 1}`, 'Aetherite vein', p, [1, 1, 1], veins, [0, index * 0.7, 0]);
    s.setObjectVariable(vein, 'tags', 'cf-vein'); s.attachScript(vein, mineBlueprint);
    light(`Aetherite light ${index + 1}`, [p[0], 1.5, p[2]], '#6be3c1', 22, 12, veins);
    if (index === 0) s.createPrefabFromObject(vein, 'Cinderfall · Mineable aetherite vein', prefabs);
  }

  const brain = compile('Cinderfall · Cavewarden behaviour', 'A normal character controller and editable chase/contact rules. Alert thresholds spread the pressure across the expedition.', `blueprint Cinderfall_Cavewarden
var alert_at: number = 0
var speed: number = 2
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and self.health > 0:
        if Game.CFOre >= self.alert_at and AI.distance_to_player() < 23:
            self.move_to(Player.location, speed: self.speed)
            self.face_player()
            if AI.distance_to_player() < 1.65:
                if cooldown(1.1):
                    apply_damage("$player", 12)`);
  const legAnimation = compile('Cinderfall · Cavewarden gait', 'Reusable phase-shifted leg motion, parented to the creature. Change cadence and sweep to restyle it.', `blueprint Cinderfall_Gait
var phase: number = 0
var t: number = 0
var owner: object = ""
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false and get_var(self.owner, "health") > 0:
        self.t = self.t + dt
        set_rotation(self, vec3(0, sin(self.t * 8 + self.phase) * 16, sin(self.t * 8 + self.phase) * 8))`);
  for (const [index, p] of CINDERFALL_CREATURES.entries()) {
    const creature = model(`Cavewarden ${index + 1}`, 'Cavewarden shell', p, [1, 1, 1], creatures);
    patch(creature, { character: { ...defaultCharacter(), enabled: true, cameraFollow: false, autoInputWithScript: false, moveSpeed: 2, jumpStrength: 0, keyAttack: 'Unbound', keyRoll: 'Unbound', keyEmote: 'Unbound', groundLevel: -4 } });
    s.setObjectVariable(creature, 'health', 84); s.setObjectVariable(creature, 'tags', 'cf-creature');
    s.setObjectVariable(creature, 'alert_at', index < 4 ? 0 : index < 6 ? 6 : 16); s.setObjectVariable(creature, 'speed', index < 4 ? 1.7 : 2.1); s.attachScript(creature, brain);
    for (let pair = 0; pair < 3; pair++) for (const side of [-1, 1]) {
      const leg = model(`Cavewarden ${index + 1} · leg ${pair + 1}${side < 0 ? 'L' : 'R'}`, 'Articulated leg', [side * 0.42, 0.55, -0.45 + pair * 0.39], [side, 1, 1], creature);
      s.attachScript(leg, legAnimation); s.setObjectVariable(leg, 'phase', pair * 2 + (side < 0 ? Math.PI : 0)); s.setObjectVariable(leg, 'owner', creature);
    }
    if (index === 0) s.createPrefabFromObject(creature, 'Cinderfall · Cavewarden creature', prefabs);
  }

  const director = root('Cinderfall · Expedition director');
  s.attachScript(director, compile('Cinderfall · Expedition rules', 'Complete brief → mine sixteen units → return within 75 seconds → extract. Replay reloads the authored scene, restoring every enemy and vein.', `blueprint Cinderfall_Expedition
on start:
    Game.CFOre = 0
    Game.CFAmmo = 24
    Game.CFReload = 0
    Game.CFSeconds = 0
    Game.CFDisplaySeconds = 0
    Game.CFTimeLeft = 75
    Game.CFKills = 0
    Game.CFPaused = false
    Game.CFHeadlamp = true
    Game.Health = 100
    Game.CFToastTime = 0
    if Game.CFStarted:
        Game.CFStage = 1
    else:
        Game.CFStage = 0
on event CFStart(payload):
    Game.CFStarted = true
    Game.CFStage = 1
    Game.CFToast = "Survey link online. Four veins fill the cargo. Watch the shadows."
    Game.CFToastTime = 4
on key_pressed("Enter"):
    if Game.CFStage == 0:
        fire_event("CFStart")
    elif Game.CFStage >= 3:
        fire_event("CFReplay")
on key_pressed("KeyP"):
    fire_event("CFPause")
on event CFPause(payload):
    if Game.CFStage > 0 and Game.CFStage < 3:
        if Game.CFPaused:
            Game.CFPaused = false
            Time.scale = 1
        else:
            Game.CFPaused = true
            Time.scale = 0
on event CFReplay(payload):
    Game.CFStarted = true
    Scene.load("${sceneId}")
on update(dt):
    if Game.CFStage > 0 and Game.CFStage < 3 and Game.CFPaused == false:
        Game.CFSeconds = Game.CFSeconds + dt
        Game.CFDisplaySeconds = floor(Game.CFSeconds)
        Game.CFToastTime = max(0, Game.CFToastTime - dt)
        Game.CFPrompt = "Find a glowing aetherite vein"
        Game.CFHint = "WASD move · Shift sprint · P pause"
        if Game.CFStage == 1:
            for vein in find_actors(tag: "cf-vein"):
                if get_var(vein, "remaining") > 0 and distance(position(vein), Player.location) < 2.8:
                    Game.CFPrompt = "HOLD E  /  EXTRACT AETHERITE"
                    Game.CFHint = "Four units per vein · rifle ammunition does not mine"
            if Game.CFOre >= Game.CFQuota:
                Game.CFStage = 2
                Game.CFToast = "Cargo secured. The rig leaves in 75 seconds. Return to the amber lights!"
                Game.CFToastTime = 5
                Audio.play("${audio.alert.id}")
        if Game.CFStage == 2:
            Game.CFPrompt = "RETURN TO THE AMBER EXTRACTION RIG"
            Game.CFHint = "Follow the warm survey beacons back toward your starting point"
            if distance(Player.location, vec3(0, 0, -16)) < 3.4:
                Game.CFPrompt = "HOLD E  /  SECURE CARGO AND EXTRACT"
                Game.CFHint = "Your expedition is ready to leave"
            if Game.CFTimeLeft <= 0:
                Game.CFStage = 4
                Game.CFHint = "The rig departed before you returned. Recover the quota, then head straight for the amber lights."
        Game.CFKills = 8
        for creature in find_actors(tag: "cf-creature"):
            if get_var(creature, "health") > 0:
                Game.CFKills = Game.CFKills - 1
            else:
                if get_var(creature, "fallen") != true:
                    set_rotation(creature, vec3(0, 0, 82))
                    set_var(creature, "fallen", true)
        if Game.Health <= 0:
            Game.CFStage = 4
            Game.CFHint = "Suit integrity failed. Reload between encounters and use the basalt buttresses as cover."
on timer(1):
    if Game.CFStage == 2 and Game.CFPaused == false:
        Game.CFTimeLeft = Game.CFTimeLeft - 1
on key_down("KeyE"):
    if Game.CFStage == 2 and Game.CFPaused == false:
        if distance(Player.location, vec3(0, 0, -16)) < 3.4:
            Game.CFStage = 3
            Audio.play("${audio.success.id}")`));
  addCinderfallUI(director);
  // The reusable prop must not carry a camera-owner reference to a pawn outside its own subtree.
  primitive('Survey rifle service bench', [4, 0.66, -15], [1.6, 1.3, 1], m.dark, 'cube', equipment, true);
  primitive('Service bench ochre top', [4, 1.37, -15], [1.7, 0.12, 1.1], m.yellow, 'cube', equipment);
  const rifleProp = model('VX-24 · Reusable field rifle', 'VX-24 Survey Rifle', [4, 1.49, -15], [1.2, 1.2, 1.2], equipment, [0, Math.PI / 2, Math.PI / 2]);
  s.createPrefabFromObject(rifleProp, 'Cinderfall · Editable survey rifle', prefabs);
  s.selectObject(playerId);
  return playerId;
}
