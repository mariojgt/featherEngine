import { selectActiveObjects, useEditorStore } from '../store/editorStore';
import type { SceneObjectKind, Vector3Tuple } from '../types';

export interface ParcelPanicCourierMaterials {
  cream: string;
  mint: string;
  ink: string;
  gold: string;
  wood: string;
  coral: string;
}

export interface ParcelPanicCourierResult {
  rigId: string;
  blueprintId: string;
}

type CourierPartKind = Extract<SceneObjectKind, 'cube' | 'sphere' | 'capsule'>;

/**
 * Add the editable primitive courier and its procedural FeatherScript animation to a player.
 *
 * The animation deliberately watches successful-action counters rather than input. The host game must
 * provide PPIntro, PPPlaying, PPPaused, PPDone, PPCarry, PPDelivered, PPPickupPulse and PPThrowPulse.
 * Increment the appropriate pulse only after a pickup/throw has actually succeeded and broadcast PPReset
 * when a round is rebuilt. Attaching the finished player hierarchy to a prefab remaps every limb reference
 * in the generated graph to that prefab's local object definitions.
 */
export function addParcelPanicCourier(
  playerId: string,
  materials: ParcelPanicCourierMaterials,
  logicFolder: string,
): ParcelPanicCourierResult {
  const store = useEditorStore.getState();
  if (!selectActiveObjects(store).some((object) => object.id === playerId)) {
    throw new Error(`Parcel Panic courier player does not exist: ${playerId}`);
  }

  const part = (
    kind: CourierPartKind,
    name: string,
    position: Vector3Tuple,
    scale: Vector3Tuple,
    materialId: string,
    parentId: string,
    rotation: Vector3Tuple = [0, 0, 0],
  ): string => {
    const id = store.createObjectWithProps(kind, { name, position, parentId });
    store.updateTransform(id, 'scale', scale);
    store.updateTransform(id, 'rotation', rotation);
    store.setObjectMaterial(id, materialId);
    return id;
  };
  const pivot = (name: string, position: Vector3Tuple, parentId: string): string =>
    store.createObjectWithProps('empty', { name, position, parentId });

  const rigId = pivot('Pip · Courier animation rig', [0, 0, 0], playerId);

  // A layered toy body keeps the original cream/mint silhouette while making every moving joint editable.
  part('cube', 'Pip · Mint jacket', [0, 0.9, 0], [0.76, 0.7, 0.56], materials.mint, rigId);
  part('cube', 'Pip · Cream chest panel', [0, 0.92, 0.3], [0.48, 0.42, 0.05], materials.cream, rigId);
  part('cube', 'Pip · Ink waist band', [0, 0.58, 0], [0.72, 0.13, 0.55], materials.ink, rigId);
  part('cube', 'Pip · Postage badge', [0, 0.94, 0.35], [0.24, 0.18, 0.04], materials.gold, rigId);
  part('cube', 'Pip · Cardboard backpack', [0, 0.92, -0.4], [0.62, 0.62, 0.3], materials.wood, rigId);
  part('cube', 'Pip · Backpack mint flap', [0, 1.13, -0.57], [0.48, 0.18, 0.06], materials.mint, rigId);

  const head = pivot('Pip · Head pivot', [0, 1.52, 0], rigId);
  part('cube', 'Pip · Cream toy head', [0, 0, 0], [0.98, 0.72, 0.72], materials.cream, head);
  part('cube', 'Pip · Ink face display', [0, 0, 0.374], [0.76, 0.44, 0.05], materials.ink, head);
  const leftEye = pivot('Pip · Left blink pivot', [-0.21, 0.06, 0.415], head);
  const rightEye = pivot('Pip · Right blink pivot', [0.21, 0.06, 0.415], head);
  part('capsule', 'Pip · Left mint eye', [0, 0, 0], [0.09, 0.15, 0.03], materials.mint, leftEye);
  part('capsule', 'Pip · Right mint eye', [0, 0, 0], [0.09, 0.15, 0.03], materials.mint, rightEye);
  part('sphere', 'Pip · Left eye glint', [0.025, 0.045, 0.025], [0.025, 0.04, 0.018], materials.cream, leftEye);
  part('sphere', 'Pip · Right eye glint', [0.025, 0.045, 0.025], [0.025, 0.04, 0.018], materials.cream, rightEye);
  part('sphere', 'Pip · Left coral cheek', [-0.35, -0.1, 0.41], [0.11, 0.065, 0.025], materials.coral, head);
  part('sphere', 'Pip · Right coral cheek', [0.35, -0.1, 0.41], [0.11, 0.065, 0.025], materials.coral, head);
  part('cube', 'Pip · Tiny smile', [0, -0.13, 0.415], [0.16, 0.035, 0.02], materials.mint, head);

  const antenna = pivot('Pip · Antenna pivot', [0.24, 0.39, 0], head);
  part('capsule', 'Pip · Antenna stem', [0, 0.2, 0], [0.055, 0.32, 0.055], materials.ink, antenna);
  part('sphere', 'Pip · Antenna collar', [0, 0.05, 0], [0.12, 0.08, 0.12], materials.gold, antenna);
  part('sphere', 'Pip · Coral antenna lamp', [0, 0.42, 0], [0.18, 0.18, 0.18], materials.coral, antenna);
  part('sphere', 'Pip · Antenna highlight', [-0.045, 0.465, 0.08], [0.045, 0.045, 0.035], materials.cream, antenna);

  const leftShoulder = pivot('Pip · Left shoulder pivot', [-0.5, 1.1, 0], rigId);
  const rightShoulder = pivot('Pip · Right shoulder pivot', [0.5, 1.1, 0], rigId);
  const leftElbow = pivot('Pip · Left elbow pivot', [0, -0.3, 0], leftShoulder);
  const rightElbow = pivot('Pip · Right elbow pivot', [0, -0.3, 0], rightShoulder);
  part('capsule', 'Pip · Left cream sleeve', [0, -0.16, 0], [0.2, 0.3, 0.21], materials.cream, leftShoulder);
  part('capsule', 'Pip · Right cream sleeve', [0, -0.16, 0], [0.2, 0.3, 0.21], materials.cream, rightShoulder);
  part('capsule', 'Pip · Left mint forearm', [0, -0.15, 0], [0.18, 0.3, 0.19], materials.mint, leftElbow);
  part('capsule', 'Pip · Right mint forearm', [0, -0.15, 0], [0.18, 0.3, 0.19], materials.mint, rightElbow);
  part('sphere', 'Pip · Left mitten', [0, -0.34, 0.03], [0.22, 0.21, 0.21], materials.cream, leftElbow);
  part('sphere', 'Pip · Right mitten', [0, -0.34, 0.03], [0.22, 0.21, 0.21], materials.cream, rightElbow);

  const leftHip = pivot('Pip · Left hip pivot', [-0.24, 0.58, 0], rigId);
  const rightHip = pivot('Pip · Right hip pivot', [0.24, 0.58, 0], rigId);
  const leftKnee = pivot('Pip · Left knee pivot', [0, -0.25, 0], leftHip);
  const rightKnee = pivot('Pip · Right knee pivot', [0, -0.25, 0], rightHip);
  part('capsule', 'Pip · Left mint upper leg', [0, -0.13, 0], [0.22, 0.28, 0.22], materials.mint, leftHip);
  part('capsule', 'Pip · Right mint upper leg', [0, -0.13, 0], [0.22, 0.28, 0.22], materials.mint, rightHip);
  part('capsule', 'Pip · Left cream shin', [0, -0.13, 0], [0.2, 0.26, 0.2], materials.cream, leftKnee);
  part('capsule', 'Pip · Right cream shin', [0, -0.13, 0], [0.2, 0.26, 0.2], materials.cream, rightKnee);
  part('cube', 'Pip · Left little boot', [0, -0.28, 0.12], [0.32, 0.22, 0.46], materials.ink, leftKnee);
  part('cube', 'Pip · Right little boot', [0, -0.28, 0.12], [0.32, 0.22, 0.46], materials.ink, rightKnee);

  const { blueprintId } = store.createBlueprintNamed(
    'Courier · Procedural character animation',
    'Movement-driven idle, walk, sprint, air, carry, delivery gestures and completion poses. Successful gameplay increments the pickup/throw pulse globals.',
    logicFolder,
  );

  const source = [
    'blueprint Parcel_Panic_Courier_Animation',
    '',
    'var ppc_anim_clock: number = 0',
    'var ppc_anim_state: string = "intro"',
    'var ppc_anim_seen_pickup: number = 0',
    'var ppc_anim_seen_throw: number = 0',
    'var ppc_anim_gesture_until: number = 0',
    'var ppc_anim_gesture: string = ""',
    'var ppc_anim_land_until: number = 0',
    'var ppc_anim_airborne: boolean = false',
    'var ppc_anim_horizontal_speed: number = 0',
    '',
    'on start:',
    '    self.ppc_anim_seen_pickup = Game.PPPickupPulse',
    '    self.ppc_anim_seen_throw = Game.PPThrowPulse',
    '    self.ppc_anim_clock = 0',
    '    self.ppc_anim_state = "intro"',
    `    set_position("${rigId}", vec3(0, 0, 0))`,
    `    set_rotation("${rigId}", vec3(0, 0, 0))`,
    '',
    'on update(dt):',
    '    if Game.PPIntro == true or Game.PPPaused == true:',
    '        self.ppc_anim_state = "gated"',
    `        set_position("${rigId}", vec3(0, 0, 0))`,
    `        set_rotation("${rigId}", vec3(0, 0, 0))`,
    `        set_rotation("${head}", vec3(0, 0, 0))`,
    `        set_rotation("${antenna}", vec3(0, 0, 0))`,
    `        set_rotation("${leftShoulder}", vec3(0, 0, -8))`,
    `        set_rotation("${rightShoulder}", vec3(0, 0, 8))`,
    `        set_rotation("${leftElbow}", vec3(0, 0, 0))`,
    `        set_rotation("${rightElbow}", vec3(0, 0, 0))`,
    `        set_rotation("${leftHip}", vec3(0, 0, -2))`,
    `        set_rotation("${rightHip}", vec3(0, 0, 2))`,
    `        set_rotation("${leftKnee}", vec3(0, 0, 0))`,
    `        set_rotation("${rightKnee}", vec3(0, 0, 0))`,
    '        if Game.PPIntro == true and Game.PPPaused == false:',
    '            self.ppc_anim_clock = self.ppc_anim_clock + dt',
    `            set_position("${rigId}", vec3(0, 0.04 + sin(self.ppc_anim_clock * 160) * 0.035, 0))`,
    `            set_rotation("${rigId}", vec3(0, 0, sin(self.ppc_anim_clock * 80) * 2.2))`,
    `            set_rotation("${head}", vec3(0, sin(self.ppc_anim_clock * 45) * 8, sin(self.ppc_anim_clock * 80) * 3))`,
    `            set_rotation("${antenna}", vec3(sin(self.ppc_anim_clock * 160) * 2, 0, sin(self.ppc_anim_clock * 320) * 11))`,
    '    else:',
    '        self.ppc_anim_clock = self.ppc_anim_clock + dt',
    '        self.ppc_anim_horizontal_speed = length(vec3(dot(velocity(self), vec3(1, 0, 0)), 0, dot(velocity(self), vec3(0, 0, 1))))',
    '        if Game.PPPickupPulse != self.ppc_anim_seen_pickup:',
    '            self.ppc_anim_seen_pickup = Game.PPPickupPulse',
    '            self.ppc_anim_gesture_until = self.ppc_anim_clock + 0.34',
    '            self.ppc_anim_gesture = "pickup"',
    '        if Game.PPThrowPulse != self.ppc_anim_seen_throw:',
    '            self.ppc_anim_seen_throw = Game.PPThrowPulse',
    '            self.ppc_anim_gesture_until = self.ppc_anim_clock + 0.42',
    '            self.ppc_anim_gesture = "throw"',
    '        if self.is_grounded() == false:',
    '            if dot(velocity(self), vec3(0, 1, 0)) > 0.4 or dot(velocity(self), vec3(0, 1, 0)) < -1.25:',
    '                self.ppc_anim_airborne = true',
    '        if Game.PPDone == true and Game.PPDelivered >= 5:',
    '            self.ppc_anim_state = "complete"',
    `            set_position("${rigId}", vec3(0, 0.08 + sin(self.ppc_anim_clock * 720) * 0.06, 0))`,
    `            set_rotation("${rigId}", vec3(0, sin(self.ppc_anim_clock * 360) * 8, sin(self.ppc_anim_clock * 720) * 3))`,
    `            set_rotation("${head}", vec3(-6, 0, sin(self.ppc_anim_clock * 360) * 8))`,
    `            set_rotation("${antenna}", vec3(0, 0, sin(self.ppc_anim_clock * 900) * 16))`,
    `            set_rotation("${leftShoulder}", vec3(-22, 0, -145))`,
    `            set_rotation("${rightShoulder}", vec3(-22, 0, 145))`,
    `            set_rotation("${leftElbow}", vec3(-28, 0, 0))`,
    `            set_rotation("${rightElbow}", vec3(-28, 0, 0))`,
    `            set_rotation("${leftHip}", vec3(sin(self.ppc_anim_clock * 720) * 8, 0, -8))`,
    `            set_rotation("${rightHip}", vec3(0 - sin(self.ppc_anim_clock * 720) * 8, 0, 8))`,
    `            set_rotation("${leftKnee}", vec3(8, 0, 0))`,
    `            set_rotation("${rightKnee}", vec3(8, 0, 0))`,
    '        else:',
    '            if Game.PPPlaying == false:',
    '                self.ppc_anim_state = "stopped"',
    `                set_position("${rigId}", vec3(0, 0, 0))`,
    `                set_rotation("${rigId}", vec3(0, 0, 0))`,
    `                set_rotation("${leftShoulder}", vec3(0, 0, -8))`,
    `                set_rotation("${rightShoulder}", vec3(0, 0, 8))`,
    `                set_rotation("${leftElbow}", vec3(0, 0, 0))`,
    `                set_rotation("${rightElbow}", vec3(0, 0, 0))`,
    '            else:',
    '                if self.ppc_anim_clock < self.ppc_anim_gesture_until:',
    '                    if self.ppc_anim_gesture == "pickup":',
    '                        self.ppc_anim_state = "pickup"',
    `                        set_position("${rigId}", vec3(0, -0.08, 0.05))`,
    `                        set_rotation("${rigId}", vec3(12, 0, 0))`,
    `                        set_rotation("${head}", vec3(10, 0, 0))`,
    `                        set_rotation("${antenna}", vec3(0, 0, -14))`,
    `                        set_rotation("${leftShoulder}", vec3(-68, 0, -16))`,
    `                        set_rotation("${rightShoulder}", vec3(-68, 0, 16))`,
    `                        set_rotation("${leftElbow}", vec3(-42, 0, 0))`,
    `                        set_rotation("${rightElbow}", vec3(-42, 0, 0))`,
    `                        set_rotation("${leftHip}", vec3(-10, 0, -5))`,
    `                        set_rotation("${rightHip}", vec3(-10, 0, 5))`,
    `                        set_rotation("${leftKnee}", vec3(24, 0, 0))`,
    `                        set_rotation("${rightKnee}", vec3(24, 0, 0))`,
    '                    else:',
    '                        self.ppc_anim_state = "throw"',
    `                        set_position("${rigId}", vec3(0, 0.02, 0))`,
    `                        set_rotation("${rigId}", vec3(-5, -18, -4))`,
    `                        set_rotation("${head}", vec3(-4, 12, 0))`,
    `                        set_rotation("${antenna}", vec3(0, 0, 18))`,
    `                        set_rotation("${leftShoulder}", vec3(-35, 0, -22))`,
    `                        set_rotation("${rightShoulder}", vec3(-122, 0, 22))`,
    `                        set_rotation("${leftElbow}", vec3(-34, 0, 0))`,
    `                        set_rotation("${rightElbow}", vec3(28, 0, 0))`,
    `                        set_rotation("${leftHip}", vec3(18, 0, -3))`,
    `                        set_rotation("${rightHip}", vec3(-18, 0, 3))`,
    `                        set_rotation("${leftKnee}", vec3(12, 0, 0))`,
    `                        set_rotation("${rightKnee}", vec3(4, 0, 0))`,
    '                else:',
    '                    if self.ppc_anim_airborne == true:',
    '                        if dot(velocity(self), vec3(0, 1, 0)) >= -0.2:',
    '                            self.ppc_anim_state = "jump"',
    `                            set_position("${rigId}", vec3(0, 0.06, 0))`,
    `                            set_rotation("${rigId}", vec3(-7, 0, 0))`,
    `                            set_rotation("${head}", vec3(-8, 0, 0))`,
    `                            set_rotation("${antenna}", vec3(0, 0, -12))`,
    `                            set_rotation("${leftShoulder}", vec3(-32, 0, -62))`,
    `                            set_rotation("${rightShoulder}", vec3(-32, 0, 62))`,
    `                            set_rotation("${leftElbow}", vec3(-24, 0, 0))`,
    `                            set_rotation("${rightElbow}", vec3(-24, 0, 0))`,
    `                            set_rotation("${leftHip}", vec3(32, 0, -5))`,
    `                            set_rotation("${rightHip}", vec3(-15, 0, 5))`,
    `                            set_rotation("${leftKnee}", vec3(-28, 0, 0))`,
    `                            set_rotation("${rightKnee}", vec3(38, 0, 0))`,
    '                        else:',
    '                            self.ppc_anim_state = "fall"',
    `                            set_position("${rigId}", vec3(0, 0, 0))`,
    `                            set_rotation("${rigId}", vec3(7, 0, 0))`,
    `                            set_rotation("${head}", vec3(9, 0, 0))`,
    `                            set_rotation("${antenna}", vec3(0, 0, 14))`,
    `                            set_rotation("${leftShoulder}", vec3(8, 0, -78))`,
    `                            set_rotation("${rightShoulder}", vec3(8, 0, 78))`,
    `                            set_rotation("${leftElbow}", vec3(18, 0, 0))`,
    `                            set_rotation("${rightElbow}", vec3(18, 0, 0))`,
    `                            set_rotation("${leftHip}", vec3(18, 0, -15))`,
    `                            set_rotation("${rightHip}", vec3(-22, 0, 15))`,
    `                            set_rotation("${leftKnee}", vec3(20, 0, 0))`,
    `                            set_rotation("${rightKnee}", vec3(20, 0, 0))`,
    '                    else:',
    '                        if self.ppc_anim_clock < self.ppc_anim_land_until:',
    '                            self.ppc_anim_state = "land"',
    `                            set_position("${rigId}", vec3(0, -0.12, 0))`,
    `                            set_rotation("${rigId}", vec3(9, 0, 0))`,
    `                            set_rotation("${head}", vec3(8, 0, 0))`,
    `                            set_rotation("${leftShoulder}", vec3(12, 0, -28))`,
    `                            set_rotation("${rightShoulder}", vec3(12, 0, 28))`,
    `                            set_rotation("${leftElbow}", vec3(18, 0, 0))`,
    `                            set_rotation("${rightElbow}", vec3(18, 0, 0))`,
    `                            set_rotation("${leftHip}", vec3(-8, 0, -12))`,
    `                            set_rotation("${rightHip}", vec3(-8, 0, 12))`,
    `                            set_rotation("${leftKnee}", vec3(38, 0, 0))`,
    `                            set_rotation("${rightKnee}", vec3(38, 0, 0))`,
    '                        else:',
    '                            if Game.PPCarry != "":',
    '                                if self.ppc_anim_horizontal_speed > 0.55:',
    '                                    self.ppc_anim_state = "carry_walk"',
    `                                    set_position("${rigId}", vec3(0, 0.035 + sin(self.ppc_anim_clock * 520) * 0.03, 0))`,
    `                                    set_rotation("${rigId}", vec3(4, sin(self.ppc_anim_clock * 260) * 1.5, sin(self.ppc_anim_clock * 260) * 2))`,
    `                                    set_rotation("${head}", vec3(-4, sin(self.ppc_anim_clock * 130) * 2, sin(self.ppc_anim_clock * 260) * 2))`,
    `                                    set_rotation("${antenna}", vec3(0, 0, sin(self.ppc_anim_clock * 520) * 10))`,
    `                                    set_rotation("${leftShoulder}", vec3(-64 + sin(self.ppc_anim_clock * 520) * 3, 0, -15))`,
    `                                    set_rotation("${rightShoulder}", vec3(-64 - sin(self.ppc_anim_clock * 520) * 3, 0, 15))`,
    `                                    set_rotation("${leftElbow}", vec3(-48, 0, 0))`,
    `                                    set_rotation("${rightElbow}", vec3(-48, 0, 0))`,
    `                                    set_rotation("${leftHip}", vec3(0 - sin(self.ppc_anim_clock * 520) * 28, 0, -2))`,
    `                                    set_rotation("${rightHip}", vec3(sin(self.ppc_anim_clock * 520) * 28, 0, 2))`,
    `                                    set_rotation("${leftKnee}", vec3(max(0, sin(self.ppc_anim_clock * 520)) * 22, 0, 0))`,
    `                                    set_rotation("${rightKnee}", vec3(max(0, 0 - sin(self.ppc_anim_clock * 520)) * 22, 0, 0))`,
    '                                else:',
    '                                    self.ppc_anim_state = "carry_idle"',
    `                                    set_position("${rigId}", vec3(0, 0.035 + sin(self.ppc_anim_clock * 160) * 0.025, 0))`,
    `                                    set_rotation("${rigId}", vec3(2 + sin(self.ppc_anim_clock * 160) * 0.7, sin(self.ppc_anim_clock * 45), sin(self.ppc_anim_clock * 80) * 1.8))`,
    `                                    set_rotation("${head}", vec3(-3 - sin(self.ppc_anim_clock * 160), sin(self.ppc_anim_clock * 45) * 5, sin(self.ppc_anim_clock * 80) * 2))`,
    `                                    set_rotation("${antenna}", vec3(sin(self.ppc_anim_clock * 160) * 2, 0, sin(self.ppc_anim_clock * 320) * 9))`,
    `                                    set_rotation("${leftShoulder}", vec3(-64 + sin(self.ppc_anim_clock * 160) * 2, 0, -15))`,
    `                                    set_rotation("${rightShoulder}", vec3(-64 + sin(self.ppc_anim_clock * 160) * 2, 0, 15))`,
    `                                    set_rotation("${leftElbow}", vec3(-48, 0, 0))`,
    `                                    set_rotation("${rightElbow}", vec3(-48, 0, 0))`,
    `                                    set_rotation("${leftHip}", vec3(0, 0, -3 + sin(self.ppc_anim_clock * 80) * 1.5))`,
    `                                    set_rotation("${rightHip}", vec3(0, 0, 3 + sin(self.ppc_anim_clock * 80) * 1.5))`,
    `                                    set_rotation("${leftKnee}", vec3(2 + sin(self.ppc_anim_clock * 160) * 1.2, 0, 0))`,
    `                                    set_rotation("${rightKnee}", vec3(2 + sin(self.ppc_anim_clock * 160) * 1.2, 0, 0))`,
    '                            else:',
    '                                if self.ppc_anim_horizontal_speed > 6.3:',
    '                                    self.ppc_anim_state = "sprint"',
    `                                    set_position("${rigId}", vec3(0, 0.035 + sin(self.ppc_anim_clock * 760) * 0.045, 0))`,
    `                                    set_rotation("${rigId}", vec3(10, 0, sin(self.ppc_anim_clock * 380) * 3))`,
    `                                    set_rotation("${head}", vec3(-7, 0, sin(self.ppc_anim_clock * 380) * 3))`,
    `                                    set_rotation("${antenna}", vec3(0, 0, sin(self.ppc_anim_clock * 760) * 14))`,
    `                                    set_rotation("${leftShoulder}", vec3(sin(self.ppc_anim_clock * 760) * 52, 0, -8))`,
    `                                    set_rotation("${rightShoulder}", vec3(0 - sin(self.ppc_anim_clock * 760) * 52, 0, 8))`,
    `                                    set_rotation("${leftElbow}", vec3(max(0, 0 - sin(self.ppc_anim_clock * 760)) * 28, 0, 0))`,
    `                                    set_rotation("${rightElbow}", vec3(max(0, sin(self.ppc_anim_clock * 760)) * 28, 0, 0))`,
    `                                    set_rotation("${leftHip}", vec3(0 - sin(self.ppc_anim_clock * 760) * 44, 0, -2))`,
    `                                    set_rotation("${rightHip}", vec3(sin(self.ppc_anim_clock * 760) * 44, 0, 2))`,
    `                                    set_rotation("${leftKnee}", vec3(max(0, sin(self.ppc_anim_clock * 760)) * 30, 0, 0))`,
    `                                    set_rotation("${rightKnee}", vec3(max(0, 0 - sin(self.ppc_anim_clock * 760)) * 30, 0, 0))`,
    '                                else:',
    '                                    if self.ppc_anim_horizontal_speed > 0.55:',
    '                                        self.ppc_anim_state = "walk"',
    `                                        set_position("${rigId}", vec3(0, 0.04 + sin(self.ppc_anim_clock * 520) * 0.04, 0))`,
    `                                        set_rotation("${rigId}", vec3(4, sin(self.ppc_anim_clock * 260) * 1.5, sin(self.ppc_anim_clock * 260) * 2.8))`,
    `                                        set_rotation("${head}", vec3(-3, sin(self.ppc_anim_clock * 130) * 2, sin(self.ppc_anim_clock * 260) * 3.5))`,
    `                                        set_rotation("${antenna}", vec3(0, 0, sin(self.ppc_anim_clock * 520) * 12))`,
    `                                        set_rotation("${leftShoulder}", vec3(sin(self.ppc_anim_clock * 520) * 38, 0, -8))`,
    `                                        set_rotation("${rightShoulder}", vec3(0 - sin(self.ppc_anim_clock * 520) * 38, 0, 8))`,
    `                                        set_rotation("${leftElbow}", vec3(6 + max(0, 0 - sin(self.ppc_anim_clock * 520)) * 20, 0, 0))`,
    `                                        set_rotation("${rightElbow}", vec3(6 + max(0, sin(self.ppc_anim_clock * 520)) * 20, 0, 0))`,
    `                                        set_rotation("${leftHip}", vec3(0 - sin(self.ppc_anim_clock * 520) * 34, 0, -2))`,
    `                                        set_rotation("${rightHip}", vec3(sin(self.ppc_anim_clock * 520) * 34, 0, 2))`,
    `                                        set_rotation("${leftKnee}", vec3(max(0, sin(self.ppc_anim_clock * 520)) * 28, 0, 0))`,
    `                                        set_rotation("${rightKnee}", vec3(max(0, 0 - sin(self.ppc_anim_clock * 520)) * 28, 0, 0))`,
    '                                    else:',
    '                                        self.ppc_anim_state = "idle"',
    `                                        set_position("${rigId}", vec3(0, 0.04 + sin(self.ppc_anim_clock * 160) * 0.035, 0))`,
    `                                        set_rotation("${rigId}", vec3(sin(self.ppc_anim_clock * 160) * 0.8, sin(self.ppc_anim_clock * 45) * 1.5, sin(self.ppc_anim_clock * 80) * 2.2))`,
    `                                        set_rotation("${head}", vec3(0 - sin(self.ppc_anim_clock * 160) * 1.2, sin(self.ppc_anim_clock * 45) * 8, sin(self.ppc_anim_clock * 80) * 3))`,
    `                                        set_rotation("${antenna}", vec3(sin(self.ppc_anim_clock * 160) * 2, 0, sin(self.ppc_anim_clock * 320) * 11))`,
    `                                        set_rotation("${leftShoulder}", vec3(sin(self.ppc_anim_clock * 80) * 3, 0, -9 + sin(self.ppc_anim_clock * 80) * 2))`,
    `                                        set_rotation("${rightShoulder}", vec3(0 - sin(self.ppc_anim_clock * 80) * 3, 0, 9 + sin(self.ppc_anim_clock * 80) * 2))`,
    `                                        set_rotation("${leftElbow}", vec3(2 + sin(self.ppc_anim_clock * 80) * 1.5, 0, 0))`,
    `                                        set_rotation("${rightElbow}", vec3(2 - sin(self.ppc_anim_clock * 80) * 1.5, 0, 0))`,
    `                                        set_rotation("${leftHip}", vec3(sin(self.ppc_anim_clock * 80) * 2, 0, -3 + sin(self.ppc_anim_clock * 80) * 2))`,
    `                                        set_rotation("${rightHip}", vec3(0 - sin(self.ppc_anim_clock * 80) * 2, 0, 3 + sin(self.ppc_anim_clock * 80) * 2))`,
    `                                        set_rotation("${leftKnee}", vec3(1.5 + sin(self.ppc_anim_clock * 160) * 1.5, 0, 0))`,
    `                                        set_rotation("${rightKnee}", vec3(1.5 + sin(self.ppc_anim_clock * 160) * 1.5, 0, 0))`,
    '',
    'on land:',
    '    if Game.PPPlaying == true and Game.PPPaused == false and Game.PPIntro == false:',
    '        self.ppc_anim_airborne = false',
    '        self.ppc_anim_land_until = self.ppc_anim_clock + 0.18',
    '        self.ppc_anim_state = "land"',
    '',
    'on timer(2.4):',
    '    if Game.PPPaused == false:',
    `        set_scale("${leftEye}", vec3(1, 0.08, 1))`,
    `        set_scale("${rightEye}", vec3(1, 0.08, 1))`,
    '        wait(0.08)',
    `        set_scale("${leftEye}", vec3(1, 1, 1))`,
    `        set_scale("${rightEye}", vec3(1, 1, 1))`,
    '',
    'on event PPPause(payload):',
    '    self.ppc_anim_state = "gated"',
    `    set_position("${rigId}", vec3(0, 0, 0))`,
    `    set_rotation("${rigId}", vec3(0, 0, 0))`,
    `    set_rotation("${head}", vec3(0, 0, 0))`,
    `    set_rotation("${antenna}", vec3(0, 0, 0))`,
    `    set_rotation("${leftShoulder}", vec3(0, 0, -8))`,
    `    set_rotation("${rightShoulder}", vec3(0, 0, 8))`,
    `    set_rotation("${leftElbow}", vec3(0, 0, 0))`,
    `    set_rotation("${rightElbow}", vec3(0, 0, 0))`,
    '',
    'on event PPReset(payload):',
    '    self.ppc_anim_clock = 0',
    '    self.ppc_anim_gesture_until = 0',
    '    self.ppc_anim_gesture = ""',
    '    self.ppc_anim_land_until = 0',
    '    self.ppc_anim_airborne = false',
    '    self.ppc_anim_horizontal_speed = 0',
    '    self.ppc_anim_seen_pickup = Game.PPPickupPulse',
    '    self.ppc_anim_seen_throw = Game.PPThrowPulse',
    '    self.ppc_anim_state = "reset"',
    `    set_position("${rigId}", vec3(0, 0, 0))`,
    `    set_rotation("${rigId}", vec3(0, 0, 0))`,
    `    set_scale("${rigId}", vec3(1, 1, 1))`,
    `    set_rotation("${head}", vec3(0, 0, 0))`,
    `    set_rotation("${antenna}", vec3(0, 0, 0))`,
    `    set_scale("${leftEye}", vec3(1, 1, 1))`,
    `    set_scale("${rightEye}", vec3(1, 1, 1))`,
    `    set_rotation("${leftShoulder}", vec3(0, 0, -8))`,
    `    set_rotation("${rightShoulder}", vec3(0, 0, 8))`,
    `    set_rotation("${leftElbow}", vec3(0, 0, 0))`,
    `    set_rotation("${rightElbow}", vec3(0, 0, 0))`,
    `    set_rotation("${leftHip}", vec3(0, 0, -2))`,
    `    set_rotation("${rightHip}", vec3(0, 0, 2))`,
    `    set_rotation("${leftKnee}", vec3(0, 0, 0))`,
    `    set_rotation("${rightKnee}", vec3(0, 0, 0))`,
  ].join('\n');

  const compiled = store.applyBlueprintFeatherSource(blueprintId, source);
  if (!compiled.ok || compiled.diagnostics.length > 0) {
    throw new Error(
      `Could not compile Parcel Panic courier animation: ${compiled.diagnostics
        .map((diagnostic) => diagnostic.message)
        .join('; ')}`,
    );
  }
  store.attachScript(playerId, blueprintId);
  return { rigId, blueprintId };
}
