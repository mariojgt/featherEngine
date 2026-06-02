import { getPlatform } from '../platform';
import { useProjectStore } from '../store/projectStore';
import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import { inspectModel } from '../three/inspectModel';
import type { AssetItem } from '../types';

/** The Quaternius "Universal Animation Library" pawn that ships with the engine (public/templates). */
const TEMPLATE_URL = 'templates/UAL1.glb';
const TEMPLATE_NAME = 'UAL1.glb';

/** Fetch + import a bundled static model from public/templates, reusing it if already imported. Returns the asset id. */
async function importBundledModel(name: string): Promise<string | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === name && a.type === 'model');
  if (existing) return existing.id;
  try {
    const response = await fetch(`templates/${name}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const file = new File([blob], name, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return assetId;
  } catch {
    return undefined; // missing/unreadable weapon model — the starter still builds without it
  }
}

/** Fetch + import a bundled sound from public/audio, reusing it if already imported. Returns the asset id. */
async function importBundledAudio(name: string): Promise<string | undefined> {
  const existing = useEditorStore.getState().assets.find((a) => a.name === name && a.type === 'audio');
  if (existing) return existing.id;
  try {
    const response = await fetch(`audio/${name}`);
    if (!response.ok) return undefined;
    const blob = await response.blob();
    const file = new File([blob], name, { type: 'audio/mpeg' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name, type: 'audio', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    return assetId;
  } catch {
    return undefined; // missing sound — the starter still plays, just silently
  }
}

/**
 * Build a ready-to-play third-person scene from the bundled rig: imports + splits the model (skeleton,
 * skeletal mesh, 45 animations), adds a ground plane, and spawns a pawn with an Idle/Walk/Jog/Jump
 * Animator Controller, a character controller (mouse-look follow camera, +Z forward), and an editable
 * controller blueprint. Returns the pawn's object id. Requires a project to be open.
 */
export async function createThirdPersonTemplate(): Promise<string | undefined> {
  const editor = useEditorStore.getState();

  // Reuse the template model if it's already imported + split; otherwise fetch + import it once.
  let modelAsset = editor.assets.find((asset) => asset.name === TEMPLATE_NAME && asset.type === 'model');
  const alreadySplit = modelAsset && editor.skeletalMeshes.some((mesh) => mesh.sourceAssetId === modelAsset!.id);

  if (!modelAsset || !alreadySplit) {
    const response = await fetch(TEMPLATE_URL);
    if (!response.ok) throw new Error('Bundled template model not found.');
    const blob = await response.blob();
    const file = new File([blob], TEMPLATE_NAME, { type: 'model/gltf-binary' });
    const platform = await getPlatform();
    const dir = useProjectStore.getState().projectDir ?? 'web';
    const { path, url } = await platform.importAsset(dir, file);
    const assetId = `asset-${crypto.randomUUID()}`;
    const item: AssetItem = { id: assetId, name: TEMPLATE_NAME, type: 'model', size: file.size, path, url, createdAt: Date.now() };
    useEditorStore.getState().addAssetItems([item]);
    const inspection = await inspectModel(file);
    useEditorStore.getState().registerImportedModel({ assetId, assetName: TEMPLATE_NAME, inspection });
    modelAsset = useEditorStore.getState().assets.find((asset) => asset.id === assetId);
  }
  if (!modelAsset) return undefined;

  const store = useEditorStore.getState();
  // Visual ground whose top sits at y=0 (the character controller's default ground level).
  const groundId = store.createObjectWithProps('cube', {
    name: 'Ground',
    position: [0, -0.1, 0],
    color: '#2A3142',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(groundId, 'scale', [24, 0.2, 24]);

  // The pawn: model + auto-built locomotion controller + character controller + editable blueprint.
  const pawnId = store.createCharacterPawn(modelAsset.id, 'Player');
  if (!pawnId) return undefined;

  // Round it out with the full gameplay kit so the template is a real game starter out of the box:
  // ranged pistol (aim/shoot/reload), health + hit reactions + death→ragdoll, interactions, and emotes.
  const kit = useEditorStore.getState().addGameplayKit;
  kit(pawnId, 'ranged');
  kit(pawnId, 'health');
  kit(pawnId, 'interactions');
  kit(pawnId, 'emotes');

  // Bundled player SFX (generated, shipped in public/audio): footsteps, jump, land, splash, swing, hurt.
  // The runtime plays each automatically on the matching event (no graph wiring needed).
  const [footstep, jump, land, splash, swing, hurt] = await Promise.all([
    importBundledAudio('footstep.mp3'),
    importBundledAudio('jump.mp3'),
    importBundledAudio('land.mp3'),
    importBundledAudio('splash.mp3'),
    importBundledAudio('sword-swing.mp3'),
    importBundledAudio('hurt.mp3'),
  ]);
  useEditorStore.getState().updateCharacterController(pawnId, {
    footstepSoundId: footstep,
    jumpSoundId: jump,
    landSoundId: land,
    swimSoundId: splash,
    attackSoundId: swing,
    hurtSoundId: hurt,
  });

  // Atmosphere: a looping ambient bed + background music on the active scene (Play starts/stops them).
  const [ambient, music] = await Promise.all([importBundledAudio('ambient.mp3'), importBundledAudio('music.mp3')]);
  const sceneId = useEditorStore.getState().activeSceneId;
  useEditorStore.getState().setSceneAudio(sceneId, { ambientSoundId: ambient, musicSoundId: music });

  // Ammo: the pistol HUD ammo counter + per-shot consumption + reload (R) refill key off these vars.
  useEditorStore.getState().setObjectVariable(pawnId, 'ammo', 12);
  useEditorStore.getState().setObjectVariable(pawnId, 'ammoMax', 12);

  await assembleStarter(pawnId);
  // Sort the imported sounds into an Audio folder so the browser stays tidy.
  const audioFolder = useEditorStore.getState().createFolder('Audio');
  for (const id of [footstep, jump, land, splash, swing, hurt, ambient, music]) {
    if (id) useEditorStore.getState().moveToFolder('asset', id, audioFolder);
  }
  return pawnId;
}

/**
 * Turn the bare pawn into a playable starter: weapons you EQUIP BY WALKING OVER pickups in the world,
 * gated click-to-shoot when the pistol is out, a HUD health bar, a damageable target dummy, and floating
 * in-world tutorial signs. Everything it creates is sorted into project folders.
 */
async function assembleStarter(pawnId: string): Promise<void> {
  const swordAsset = await importBundledModel('Sword.glb');
  const pistolAsset = await importBundledModel('Pistol.glb');

  const store = useEditorStore.getState();
  const player = selectActiveObjects(store).find((o) => o.id === pawnId);
  const blueprintId = player?.script?.blueprintId;
  // createCharacterPawn sets the pawn's animator via a controllerId (not skeletalMeshId), so resolve the
  // skeleton from the controller — falling back to the rendered model's skeletal mesh.
  const controller = store.animatorControllers.find((c) => c.id === player?.animator?.controllerId);
  const skeletonId =
    controller?.skeletonId ?? store.skeletalMeshes.find((m) => m.sourceAssetId === player?.renderer?.modelAssetId)?.skeletonId;
  if (!player || !blueprintId || !skeletonId) return;

  // --- Project structure: tuck generated assets into folders so the browser stays tidy. ---
  const weaponsFolder = store.createFolder('Weapons');
  const uiFolder = store.createFolder('UI');
  if (swordAsset) store.moveToFolder('asset', swordAsset, weaponsFolder);
  if (pistolAsset) store.moveToFolder('asset', pistolAsset, weaponsFolder);
  store.moveToFolder('blueprint', blueprintId, store.createFolder('Player'));

  // The bundled weapon GLBs carry a 100× baked scale (FBX→glTF artifact); ModelAsset auto-normalizes such
  // extreme models to ~1 unit, so these are now intuitive fractions of a unit (sword ≈ 0.85u long, pistol
  // ≈ 0.3u). Tune per-object in the Inspector if needed.
  const SWORD_SCALE = 0.85;
  const PISTOL_SCALE = 0.3;

  // hand_r bind orientation (from the GLB): local +Z → world forward, local +X → world up. The sword's
  // blade is the model's +Z and the pistol's barrel is the model's +X, so we rotate each weapon about Y to
  // seat the grip: sword +90° (blade up), pistol −90° (barrel forward). The weapon is SPAWNED on equip and
  // attached to this socket (Unreal-style) — it carries this offset, so it doesn't depend on a map object.
  store.addSkeletonSocket(skeletonId, { name: 'RightHand', boneName: 'hand_r' });
  const SWORD_YAW = (90 * Math.PI) / 180;
  const PISTOL_YAW = (-90 * Math.PI) / 180;

  // Node helpers. `add` resolves the node kind from its label; `chain` wires exec-out → exec-in in order.
  const RUNTIME = new Set(['Spawn Attached', 'Spawn Projectile', 'Set Anim Bool', 'Destroy Object', 'Get Anim Param']);
  const add = (label: string, data?: Record<string, unknown>) =>
    store.addGraphNodeToBlueprint(blueprintId, label, RUNTIME.has(label) ? 'Runtime' : label === 'Branch' ? 'Logic' : 'Events', data);
  const chain = (ids: Array<string | undefined>) => {
    const seq = ids.filter(Boolean) as string[];
    for (let i = 0; i < seq.length - 1; i++) store.connectGraphNodes(blueprintId, seq[i], seq[i + 1], 'exec-out', 'exec-in');
  };

  // A reusable on-SCREEN prompt widget (hidden until shown), styled as a centered toast near the bottom.
  const makeScreenPrompt = (text: string) => {
    const doc = store.createUIDocument('Prompt', 'screen');
    store.updateUIDocument(doc, { visibleOnStart: false });
    const labelId = store.addUIPreset(doc, undefined, 'label');
    store.updateUIElement(doc, labelId, {
      text,
      style: {
        color: '#ffffff',
        fontSize: '18px',
        fontWeight: '600',
        background: 'rgba(15,17,23,0.78)',
        padding: '10px 18px',
        borderRadius: '10px',
        custom: { position: 'absolute', bottom: '96px', left: '50%', transform: 'translateX(-50%)', whiteSpace: 'nowrap' },
      },
    });
    store.moveToFolder('uiDocument', doc, uiFolder);
    return doc;
  };

  // --- Pickups: ONE self-contained object (weapon model + generous trigger) with its OWN equip script, so
  //     it works dropped anywhere. Walking into it spawns the weapon attached to WHOEVER touched it ($trigger)
  //     and removes itself. Each is registered as a reusable PREFAB in the Weapons folder.
  //     `pickupScale` = ground item + trigger size (catchable); `attachScale` = in-hand size. ---
  const makePickup = (name: string, assetId: string | undefined, position: [number, number, number], rangedMode: boolean, pickupScale: number, attachScale: number, yaw: number) => {
    if (!assetId) return;
    const pickupId = store.createObjectWithProps('cube', {
      name,
      position,
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
    });
    store.setObjectModel(pickupId, assetId);
    store.updateTransform(pickupId, 'scale', [pickupScale, pickupScale, pickupScale]);
    // Self-contained equip logic ON the pickup (not the player), so the prefab is portable.
    const { blueprintId: bpId } = store.createBlueprintNamed(`${name} Logic`, 'Equip-on-touch weapon pickup.', weaponsFolder);
    store.attachScript(pickupId, bpId);
    const addP = (label: string, data?: Record<string, unknown>) =>
      store.addGraphNodeToBlueprint(bpId, label, RUNTIME.has(label) ? 'Runtime' : 'Events', data);
    const chainP = (ids: Array<string | undefined>) => {
      const seq = ids.filter(Boolean) as string[];
      for (let i = 0; i < seq.length - 1; i++) store.connectGraphNodes(bpId, seq[i], seq[i + 1], 'exec-out', 'exec-in');
    };
    chainP([
      addP('Trigger Enter'), // no filter → fires for whoever overlaps the pickup
      addP('Spawn Attached', {
        assetId,
        targetObjectId: '$trigger', // attach to the toucher (the player), not the pickup
        attachSocketName: 'RightHand',
        attachBoneName: 'hand_r',
        attachOffsetRotation: [0, yaw, 0],
        attachOffsetScale: [attachScale, attachScale, attachScale],
        attachOffsetPosition: [0, 0, 0],
      }),
      addP('Set Anim Bool', { paramName: 'RangedMode', booleanValue: rangedMode, targetObjectId: '$trigger' }),
      addP('Destroy Object'), // no target → destroy self (the pickup)
    ]);
    // Register as a reusable prefab — drop more copies from the Project browser; each works on its own.
    store.createPrefabFromObject(pickupId, `${name} Prefab`, weaponsFolder);
  };
  makePickup('Sword Pickup', swordAsset, [-2.5, 0.6, 5], false, 1.2, SWORD_SCALE, SWORD_YAW);
  makePickup('Pistol Pickup', pistolAsset, [2.5, 0.6, 5], true, 0.8, PISTOL_SCALE, PISTOL_YAW);

  // --- Click (release) → fire a projectile, but ONLY while the pistol is equipped (RangedMode true). ---
  const shoot = add('Key Up', { keyCode: 'Mouse0' });
  const rangedCheck = add('Get Anim Param', { paramName: 'RangedMode' });
  const gate = add('Branch');
  store.connectGraphNodes(blueprintId, rangedCheck, gate, 'value-out', 'condition');
  chain([shoot, gate, add('Spawn Projectile', { projectileSpeed: 24, projectileDamage: 34 })]);

  // --- HUD: a persistent controls hint + a health bar bound to the kit's Health variable. ---
  const hud = store.createUIDocument('HUD', 'screen');
  store.updateUIDocument(hud, { visibleOnStart: true });
  const hintId = store.addUIPreset(hud, undefined, 'label');
  store.updateUIElement(hud, hintId, {
    text: 'WASD move · Mouse aim · LMB shoot · RMB aim · R reload · E interact · Space jump · Q roll · swim/climb',
    style: { color: '#cfd6e6', fontSize: '14px', custom: { position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)' } },
  });
  store.addUIPreset(hud, undefined, 'healthBar', { variableName: 'Health' });
  store.moveToFolder('uiDocument', hud, uiFolder);

  // --- A target dummy to shoot: takes projectile damage and is destroyed at 0 health. Shows a prompt nearby. ---
  store.createObjectWithProps('capsule', {
    name: 'Target Dummy',
    position: [0, 1, 9],
    color: '#e36464',
    physics: { enabled: true, bodyType: 'fixed', collider: 'capsule' },
  });
  const dummy = selectActiveObjects(useEditorStore.getState()).find((o) => o.name === 'Target Dummy');
  if (dummy) {
    store.setObjectVariable(dummy.id, 'health', 100);
    const dummyPrompt = makeScreenPrompt('🎯  Equip the pistol and shoot the dummy!');
    const dummyZone = store.createObjectWithProps('empty', {
      name: 'Dummy Proximity',
      position: [0, 1, 9],
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
    });
    store.updateTransform(dummyZone, 'scale', [4, 2, 4]);
    chain([add('Trigger Enter', { otherObjectId: dummyZone }), add('Show UI', { documentId: dummyPrompt })]);
    chain([add('Trigger Exit', { otherObjectId: dummyZone }), add('Hide UI', { documentId: dummyPrompt })]);
  }

  // --- Water pool: a tagged water VOLUME (trigger). Walk in → SWIM mode (Space rises, C sinks, float). ---
  const waterId = store.createObjectWithProps('cube', {
    name: 'Water Pool',
    position: [11, 0.5, 0],
    color: '#2f6fb0',
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
  });
  store.updateTransform(waterId, 'scale', [7, 1.2, 7]);
  store.setObjectVariable(waterId, 'volume', 'water');
  // Water FX: translucent, glossy, faintly glowing surface so you can see the character swim through it.
  store.updateRenderer(waterId, { opacity: 0.5, metalness: 0.1, roughness: 0.08, color: '#2f8fd0' });

  // --- Climb wall: a solid wall + a climb VOLUME on its face. Walk into it, hold W to climb up / S down. ---
  const wallId = store.createObjectWithProps('cube', {
    name: 'Climb Wall',
    position: [-11, 2.5, 0],
    color: '#6b7280',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(wallId, 'scale', [3, 5, 0.5]);
  const climbZone = store.createObjectWithProps('empty', {
    name: 'Climb Volume',
    position: [-11, 2.5, 0.7],
    physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
  });
  store.updateTransform(climbZone, 'scale', [3, 5, 1.2]);
  store.setObjectVariable(climbZone, 'volume', 'climb');

  // --- Interaction demo: a treasure chest you press E to open (Unreal-style focus highlight + prompt). ---
  const chestId = store.createObjectWithProps('cube', {
    name: 'Treasure Chest',
    position: [4.5, 0.5, -4.5],
    color: '#c9a23f',
    physics: { enabled: true, bodyType: 'fixed', collider: 'box' },
  });
  store.updateTransform(chestId, 'scale', [1.2, 0.85, 0.85]);
  store.setObjectVariable(chestId, 'interactable', true);
  store.setObjectVariable(chestId, 'interactPrompt', 'Open Chest');
  const chestMsg = makeScreenPrompt('✨ The chest opens — you found a relic!');
  const { blueprintId: chestBp } = store.createBlueprintNamed('Chest Logic', 'Press E to open this chest.', uiFolder);
  store.attachScript(chestId, chestBp);
  const addChest = (label: string, data?: Record<string, unknown>) =>
    store.addGraphNodeToBlueprint(chestBp, label, label === 'Interact' ? 'Events' : 'Runtime', data);
  const chainChest = (ids: Array<string | undefined>) => {
    const seq = ids.filter(Boolean) as string[];
    for (let i = 0; i < seq.length - 1; i++) store.connectGraphNodes(chestBp, seq[i], seq[i + 1], 'exec-out', 'exec-in');
  };
  // E while focused → glow gold (emissive), pop the message, then stop being interactable (one-time open).
  chainChest([
    addChest('Interact'),
    addChest('Set Material Color', { materialColor: '#ffd86b', materialColorTarget: 'emissive' }),
    addChest('Show UI', { documentId: chestMsg }),
    addChest('Set Object Var', { objectKey: 'interactable', booleanValue: false }),
  ]);

  // --- Combat demo: a roaming enemy that CHASES the player when near and deals contact damage. Shoot it. ---
  const enemyId = store.createObjectWithProps('capsule', {
    name: 'Skeleton',
    position: [-5, 1, -7],
    color: '#b8c0cc',
    physics: { enabled: true, bodyType: 'kinematic', collider: 'capsule' },
  });
  store.setObjectVariable(enemyId, 'enemy', true);
  store.setObjectVariable(enemyId, 'health', 60);
  store.setObjectVariable(enemyId, 'enemySpeed', 3);
  store.setObjectVariable(enemyId, 'chaseRange', 11);
  store.setObjectVariable(enemyId, 'enemyDamage', 8);
  store.setObjectVariable(enemyId, 'attackRange', 1.8);

  // --- Surface-aware footsteps: a stone path VOLUME — footsteps over it use a stone sound. ---
  const stoneStep = await importBundledAudio('footstep-stone.mp3');
  if (stoneStep) {
    const stoneFolder = useEditorStore.getState().assets.find((a) => a.id === stoneStep)?.folderId;
    if (!stoneFolder) {
      const audioFolder = useEditorStore.getState().folders.find((f) => f.name === 'Audio');
      if (audioFolder) useEditorStore.getState().moveToFolder('asset', stoneStep, audioFolder.id);
    }
    const stoneId = store.createObjectWithProps('cube', {
      name: 'Stone Path',
      position: [0, 0.05, -5],
      color: '#8a8f99',
      physics: { enabled: true, bodyType: 'dynamic', collider: 'box', isTrigger: true, gravityScale: 0 },
    });
    store.updateTransform(stoneId, 'scale', [5, 1.4, 6]);
    store.setObjectVariable(stoneId, 'footstepSound', stoneStep);
  }
}
