import type { Vector3Tuple } from './common';

/**
 * A built-in arcade VEHICLE (car) controller — the driving peer of {@link CharacterControllerComponent}.
 * During Play the runtime's vehicle pass reads WASD (W throttle / S brake+reverse / A,D steer, Space
 * handbrake), integrates a signed forward speed, steers the yaw (scaled by speed), and drives the body's
 * horizontal motion; VERTICAL motion is left to the Rapier dynamic body so the car rides terrain, climbs
 * ramps and bumps props for free. The handling model keeps forward speed, lateral slip, load transfer,
 * traction control and optional aero downforce separate so cars slide/recover believably without needing a
 * full soft-body vehicle solver. Suspension "feel" is visual: the chassis squats/dives (bodyPitch) and
 * leans into turns (bodyRoll), and the wheel child objects spin (∝ speed) + the front pair steers. A
 * follow camera (shared with the character follow camera) trails the car with mouse orbit.
 */
/** One explicit wheel reference on a vehicle (Unreal-style wheel setup): the wheel object plus its ROLE,
 *  so the physics never has to infer front/rear/left/right from array position. */
export interface VehicleWheelSetup {
  /** The spinning wheel mesh object (a child of the car, or of a steering-anchor empty under the car). */
  objectId: string;
  /** Which end of the car — drives the drivetrain split (fwd/rwd), brake bias, and anti-roll pairing. */
  axle: 'front' | 'rear';
  /** Which side — drives auto-fit placement and anti-roll left↔right pairing. */
  side: 'left' | 'right';
  /** Whether this wheel turns with steering input. Defaults to true on the front axle. */
  steered?: boolean;
}

export interface VehicleComponent {
  enabled: boolean;
  /** Which simulation drives the car. `'arcade'` (default/absent) = the hand-rolled tire model below.
   *  `'raycast'` = a real Rapier `DynamicRayCastVehicleController` (per-wheel ray-cast suspension, weight
   *  transfer, tire friction, genuine rollovers) — see the "--- Raycast sim ---" fields. */
  physicsModel?: 'arcade' | 'raycast';
  // --- Drivetrain ---
  /** Top forward speed (units/sec). */
  maxSpeed: number;
  /** Top reverse speed (units/sec). */
  maxReverseSpeed: number;
  /** Throttle acceleration (units/sec²). */
  acceleration: number;
  /** Brake deceleration (units/sec²) when reversing input fights forward motion. */
  braking: number;
  /** Coasting deceleration (units/sec²) when no throttle/brake is held. */
  drag: number;
  // --- Steering ---
  /** Max visual front-wheel steer angle (radians). */
  steerAngle: number;
  /** Yaw turn rate (radians/sec) at full lock and full speed. */
  turnRate: number;
  /** How fast the steering reads in/out (0..1 smoothing per frame). */
  steerReturnSpeed: number;
  /** Lateral grip 0..1 — drives how hard the chassis leans into a turn (visual). */
  gripFactor: number;
  /** Grip while the handbrake is held (lower = looser, for drift feel). */
  handbrakeGrip: number;
  /** How much accel/brake/cornering load temporarily reduces tire grip (0 = flat arcade, 1 = weighty). */
  weightTransfer: number;
  /** How strongly throttle is cut when the tires are already slipping (0 = off, 1 = strong assist). */
  tractionControl: number;
  /** Speed-squared grip/downward force for planted high-speed handling. 0 = none. */
  downforce: number;
  // --- Suspension / feel (visual) ---
  /** Wheel suspension travel (world units) — reserved for ride-height bob. */
  suspensionTravel: number;
  /** Suspension stiffness 0..1 — how quickly chassis lean/squat settles. */
  suspensionStiffness: number;
  /** Chassis lean into turns (radians per unit of lateral load). */
  bodyRoll: number;
  /** Chassis squat/dive under accel/brake (radians per unit of longitudinal load). */
  bodyPitch: number;
  // --- Crash / damage feel ---
  /** When true, hard impacts add damage, angular impulses, wheel damage, and let physics roll the car. */
  crashDamageEnabled?: boolean;
  /** Impact speed below this is treated as a normal bump. */
  crashDamageThreshold?: number;
  /** Impact speed that starts a rollover/tumble response. */
  crashRolloverThreshold?: number;
  /** Angular impulse multiplier applied on hard impacts. */
  crashRolloverStrength?: number;
  /** Runtime visual crush amount 0..1 driven by accumulated crash damage. */
  crashDeformation?: number;
  /** Accumulated damage at which individual wheels start hanging crooked. */
  crashWheelBreakThreshold?: number;
  /** Spawn small dynamic debris chunks on heavy impacts. */
  crashDebris?: boolean;
  /** Wheel radius (world units) — sets how fast wheels spin for a given speed. */
  wheelRadius: number;
  /** Distance from the car body's origin down to the wheel-contact (ground) plane. The kinematic body's
   *  Y is set to groundHeight + rideHeight so the wheels rest on the terrain. Usually -(body bbox min Y). */
  rideHeight: number;
  /** Authored local Y of the wheel centers — the suspension bobs each wheel around this rest height. */
  wheelRestY: number;
  // --- Wiring (child object ids) ---
  /** The 4 wheel child objects, conventionally [frontLeft, frontRight, rearLeft, rearRight]. */
  wheelObjectIds: string[];
  /** Which of the wheels steer (the front pair). */
  steeredWheelIds: string[];
  /** Optional world-space particle emitters enabled by tire slip / handbrake for dust or fading tire marks. */
  tireMarkIds: string[];
  /** Optional particle emitters (exhaust flames) switched ON while the "Nitro" var is active (boost VFX). */
  boostFlameIds?: string[];
  /** In-game GARAGE: ordered list of body model asset ids. A "CarBody" project var picks which one the chassis
   *  shows at runtime (the runtime swaps renderer.modelAssetId → the raycast chassis re-sizes to it). */
  garageBodyIds?: string[];
  /** Explicit wheel rig (PREFERRED, Unreal-style): each wheel object referenced WITH its role, so nothing
   *  depends on array order. When present this wins over the legacy positional convention
   *  (wheelObjectIds in [FL,FR,RL,RR] order + steeredWheelIds). */
  wheels?: VehicleWheelSetup[];
  /** Soft-body crash damage: when true, the body MESH plastically dents/crumples on hard impacts during Play
   *  (the runtime records dents from collision direction + force; the model renderer displaces the vertices). */
  deformable?: boolean;
  /** Headlight child objects (kind 'light') — informational; lit via the light component. */
  headlightIds: string[];
  /** Brake-light child objects — their emissive intensity is raised while braking/reversing. */
  brakeLightIds: string[];
  /** Brake DISC child objects — their emissive glows with accumulated brake HEAT (sustained hard braking
   *  from speed heats them orange; they cool back down when released). Raycast sim only. */
  brakeDiscIds?: string[];
  /** LOOSE cosmetic child parts (bumpers / spoiler / side skirts): on a hard enough impact, the part
   *  facing the hit TEARS OFF — it becomes a real dynamic prop that tumbles away with the car's momentum.
   *  R-respawn (repair) bolts everything back on. Raycast sim only. */
  loosePartIds?: string[];
  /** Onboard camera positions (car-local [side, up, forward]); the Play camera cycles chase → hood →
   *  cockpit on the C key. Defaults fit a typical sedan when absent. */
  hoodCameraOffset?: Vector3Tuple;
  cockpitCameraOffset?: Vector3Tuple;
  // --- Input bindings (KeyboardEvent.code) ---
  keyThrottle: string;
  keyReverse: string;
  keyLeft: string;
  keyRight: string;
  keyHandbrake: string;
  /** Sound the horn (one-shot, debounced). */
  keyHorn: string;
  // --- Camera (shared shape with the character follow camera) ---
  /** Use this car's follow camera in game view / export. */
  cameraFollow: boolean;
  /** Resting camera offset [side, up, back]; negative back sits behind a +Z-forward car. */
  cameraOffset: Vector3Tuple;
  cameraPitch: number;
  cameraMinPitch: number;
  cameraMaxPitch: number;
  /** Orbit the follow camera with the mouse. */
  mouseLook: boolean;
  mouseSensitivity: number;
  /** Audio asset id looped as the engine sound while driving (its playback rate rises with speed). */
  engineSoundId?: string;
  /** Audio asset id looped (volume rises with slip) while the tires skid — handbrake drift / hard cornering. */
  skidSoundId?: string;
  /** One-shot brake squeal fired when the car decelerates hard from speed. */
  brakeSoundId?: string;
  /** One-shot horn fired on the horn key. */
  hornSoundId?: string;
  /** One-shot impact fired when the car collides with something while moving. */
  collisionSoundId?: string;
  // --- Raycast sim (physicsModel === 'raycast' only) ---
  // These map ~1:1 onto Rapier's DynamicRayCastVehicleController. Ignored in arcade mode. All optional so
  // existing saved cars (no sim block) load unchanged; defaultVehicle() supplies tuned values.
  /** Max engine force (newtons) applied at full throttle, split across the driven wheels. */
  engineForce?: number;
  /** Max braking force (newtons) at full brake, split across all wheels (biased by brakeBias). */
  brakeForce?: number;
  /** Extra braking force (newtons) the handbrake adds to the rear wheels (for handbrake turns). */
  handbrakeForce?: number;
  /** Which wheels receive engine force: front / rear / all-wheel drive. */
  drivetrain?: 'fwd' | 'rwd' | 'awd';
  /** Brake distribution, 0..1: 0 = all rear, 0.5 = even, 1 = all front. */
  brakeBias?: number;
  /** Chassis mass (kg) — heavier = more planted, slower to change direction. */
  chassisMass?: number;
  /** Center-of-mass offset on local Y (world units). Negative drops it below the chassis origin → far less
   *  prone to rolling over (the single biggest stability lever for a sim car). */
  centerOfMassY?: number;
  /** Chassis linear damping (air/rolling drag). */
  linearDamping?: number;
  /** Chassis angular damping (settles spin/wobble). */
  angularDamping?: number;
  /** Tire longitudinal/forward friction coefficient — higher = more grip, less wheelspin. */
  wheelFrictionSlip?: number;
  /** Lateral grip stiffness — how hard tires resist sliding sideways (cornering bite). */
  sideFrictionStiffness?: number;
  /** Suspension rest length (world units) — natural extension of the spring with no load. */
  suspensionRestLength?: number;
  /** Suspension spring stiffness (real Rapier units; distinct from the arcade visual `suspensionStiffness`). */
  suspensionStiffnessSim?: number;
  /** Suspension damping while compressing. */
  suspensionCompression?: number;
  /** Suspension damping while relaxing/extending. */
  suspensionRelaxation?: number;
  /** Clamp on suspension force (newtons) so a hard landing can't fling the chassis. */
  maxSuspensionForce?: number;
  /** Max suspension travel (world units) before it bottoms out. */
  maxSuspensionTravelSim?: number;
  // --- Raycast sim: drivetrain simulation (engine + gearbox) ---
  /** 'auto' shifts itself on RPM thresholds; 'manual' shifts only on keyShiftUp/keyShiftDown. */
  transmission?: 'auto' | 'manual';
  /** Forward gear ratios, 1st → top (e.g. [3.1, 2.05, 1.55, 1.2, 0.97, 0.8]). Reverse reuses 1st. */
  gearRatios?: number[];
  /** Final-drive (differential) ratio multiplied into every gear. */
  finalDrive?: number;
  /** Engine idle RPM (the tachometer floor). */
  idleRpm?: number;
  /** Redline RPM — the rev limiter cuts engine force just past this. */
  maxRpm?: number;
  /** Auto gearbox: upshift when engine RPM exceeds this (under throttle). */
  shiftUpRpm?: number;
  /** Auto gearbox: downshift when engine RPM falls below this. */
  shiftDownRpm?: number;
  /** Seconds of torque cut while a shift completes (the "shift kick" feel). */
  shiftTime?: number;
  /** Manual transmission: shift up / shift down key codes (gamepad Y/LB hit these via the default aliases). */
  keyShiftUp?: string;
  keyShiftDown?: string;
  // --- Raycast sim: aero + anti-roll + assists + surfaces ---
  /** Quadratic air drag coefficient — shapes top speed (force = aeroDrag · speed², against travel). */
  aeroDrag?: number;
  /** Downforce coefficient (speed² downward push while grounded). Replaces the old hardcoded 1.1. */
  downforceSim?: number;
  /** Front/rear anti-roll bar stiffness (N per metre of left↔right suspension difference). Less body roll,
   *  flatter cornering; a stiffer REAR bar adds oversteer, stiffer FRONT adds understeer (real tuning lever). */
  antiRollFront?: number;
  antiRollRear?: number;
  /** ABS assist: while braking hard the brakes ease off enough to keep the front tires steering. */
  absEnabled?: boolean;
  /** Traction control assist: cuts engine power during wheelspin launches and power-oversteer slides. */
  tcsEnabled?: boolean;
  /** Per-wheel surface grip: each wheel reads the `surface` instance variable of whatever it's rolling on
   *  (tarmac/curb/dirt/grass/gravel/sand/mud/snow/ice) and scales its grip — going wide costs lap time. */
  surfaceGripEnabled?: boolean;
  // --- Raycast sim: driving feel (engine braking, weight transfer, counter-steer) ---
  /** Engine braking (newtons at the driven wheels) when coasting off-throttle in gear — compression braking
   *  that scales with gear ratio and RPM, so lifting (or a manual downshift) genuinely slows the car into a
   *  corner instead of it freewheeling. 0 disables. */
  engineBrakeForce?: number;
  /** Load-sensitive lateral grip, 0..1: weight transfer shifts cornering grip toward the loaded axle —
   *  trail-braking sharpens turn-in, lifting mid-corner loosens the rear (lift-off oversteer), throttle
   *  plants the rear on exit. Balance only (average grip is unchanged). 0 = off. */
  loadSensitivity?: number;
  /** Counter-steer assist, 0..1: feeds automatic opposite lock toward the chassis slip angle once the car
   *  is genuinely sliding, keeping drifts and snap-oversteer catchable without fast hands. 0 = off. */
  counterSteerAssist?: number;
  // --- AI rival driver (works for both arcade and raycast cars) ---
  /** This car drives ITSELF around the scene's "Checkpoint <n>" gates (the same objects the lap system
   *  reads) — no blueprint needed. It steers toward the next gate, slows for corners, reverses out when
   *  stuck, and waits for the green light when a "Driving" var gates the race start. */
  aiDriver?: boolean;
  /** Rival pace, 0..1: corner speed, straight-line commitment and steering aggression (default 0.7). */
  aiSkill?: number;
  /** Rubber-banding, 0..1: rivals quietly slow when ahead of the player and push when behind, keeping the
   *  race close (default 0.5; 0 = honest pace). */
  aiRubberBand?: number;
  /** How the AI driver uses the "Checkpoint <n>" gates. 'race' (default): laps them IN ORDER at racing
   *  pace. 'wander': ambient TRAFFIC — on reaching a gate it picks a random nearby gate next (treating
   *  the checkpoints as a road network), cruises at city pace, ignores rubber-banding and the race grid. */
  aiMode?: 'race' | 'wander';
}

