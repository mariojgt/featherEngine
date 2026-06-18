import type { SceneObjectKind, Vector3Tuple } from './common';
import type { MaterialOverrides } from './geometry';

export type CinematicActionType = 'camera' | 'transform' | 'visibility' | 'spawn' | 'animation' | 'sound' | 'event' | 'fade' | 'material' | 'timeDilation' | 'subsequence' | 'text';

/** On-screen placement for a `type: 'text'` overlay beat (title card / subtitle / lower-third / credit). */
export type CinematicTextStyle = 'subtitle' | 'title' | 'lowerThird' | 'credit';

/**
 * Interpolation curve applied to a beat's progress (and to camera shot-to-shot blends).
 * `smooth` (ease-in-out) is the cinematic default; `linear` is a constant-speed move;
 * `in`/`out` accelerate/decelerate at one end.
 */
export type CinematicEase = 'linear' | 'smooth' | 'in' | 'out';

/** Interpolation mode for keyframed camera/object/material tracks. */
export type CinematicInterpolation = 'smooth' | 'linear' | 'hold';

/**
 * One keyframe on a camera beat's animated track: the camera's framing at an absolute time
 * (seconds from the cinematic start). A camera beat with two or more keyframes smoothly flies
 * through all of them (Catmull-Rom spline through positions/look-ats, eased FOV). This is the
 * "keyframe the camera" workflow — scrub the playhead, frame the viewport, capture a keyframe.
 */
export interface CinematicCameraKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  /** Depth-of-field focus distance in world units ahead of the camera (along the look direction).
   *  Splined across keyframes for rack-focus pulls. Requires `aperture > 0` to take visible effect. */
  focusDistance?: number;
  /** Depth-of-field blur strength (bokeh scale). 0 (or omitted) = no DoF / everything sharp. */
  aperture?: number;
}

/**
 * One keyframe on a transform beat's animated track: an object's full transform at an absolute
 * time. A transform beat with ≥2 keyframes smoothly drives the object through them (Catmull-Rom
 * spline). This is the Unreal-Sequencer-style "keyframe the object" workflow — scrub, pose, key.
 */
export interface CinematicTransformKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

/** One keyframe on a material/property track. Missing fields hold/interpolate from neighbouring keys. */
export interface CinematicMaterialKeyframe {
  /** Absolute time in seconds from the cinematic start. */
  time: number;
  color?: string;
  metalness?: number;
  roughness?: number;
  emissiveColor?: string;
  emissiveIntensity?: number;
}

export interface CinematicMarker {
  id: string;
  time: number;
  label: string;
  color?: string;
  /** Runtime evaluators can split work at this marker when deterministic sampling matters. */
  determinismFence?: boolean;
}

export interface CinematicAction {
  id: string;
  type: CinematicActionType;
  time: number;
  duration?: number;
  label?: string;
  /** Easing curve for this beat's from→to interpolation (camera/transform/fade). Defaults to `smooth`. */
  ease?: CinematicEase;
  /** Keyframe interpolation mode for animated tracks. Defaults to `smooth`. */
  interpolation?: CinematicInterpolation;
  /**
   * Camera beats only: seconds to glide from the previous camera shot's framing into this one.
   * `0` (or omitted) is a hard cut; any positive value produces a smooth dolly/blend between shots.
   */
  blend?: number;
  /**
   * Camera beats only: an animated camera track. With ≥2 keyframes the camera smoothly flies
   * through them over the cinematic timeline (overrides position/lookAt/fov on this beat).
   */
  keyframes?: CinematicCameraKeyframe[];
  /**
   * Transform beats only: an animated transform track for `objectId`. With ≥2 keyframes the object
   * smoothly flies through them over the timeline (overrides the from/to fields on this beat).
   */
  transformKeyframes?: CinematicTransformKeyframe[];
  /** Material/property keyframes for `type: 'material'` tracks. */
  materialKeyframes?: CinematicMaterialKeyframe[];
  objectId?: string;
  /** Subsequence id for `type: 'subsequence'` actions. */
  cinematicId?: string;
  prefabId?: string;
  spawnKind?: SceneObjectKind;
  name?: string;
  fromPosition?: Vector3Tuple;
  toPosition?: Vector3Tuple;
  fromRotation?: Vector3Tuple;
  toRotation?: Vector3Tuple;
  fromScale?: Vector3Tuple;
  toScale?: Vector3Tuple;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  lookAt?: Vector3Tuple;
  fov?: number;
  visible?: boolean;
  animationId?: string;
  animationSpeed?: number;
  soundId?: string;
  eventName?: string;
  fadeFrom?: number;
  fadeTo?: number;
  fadeColor?: string;
  /** `type: 'fade'`: dip transition — ramp fadeFrom→fadeTo over the first half, then back over the second
   *  half (a "dip to colour and back" between two shots), instead of ramping once and holding. */
  fadeDip?: boolean;
  /** `type: 'fade'`: render the fade as a directional WIPE (a colour edge sweeping across the frame in
   *  this direction) instead of a uniform opacity. Pairs with fadeDip for a wipe-on/wipe-off transition. */
  fadeWipe?: 'left' | 'right' | 'up' | 'down';
  /** `type: 'material'`: start/end material overrides for color/metal/rough/glow tracks. */
  fromMaterial?: MaterialOverrides;
  toMaterial?: MaterialOverrides;
  /** `type: 'timeDilation'`: playback speed multiplier, or from/to for a speed ramp. */
  timeScale?: number;
  fromTimeScale?: number;
  toTimeScale?: number;
  /** Camera beats only: depth-of-field focus distance in world units ahead of the camera. Used when
   *  the beat has no keyframe track. Splines/blends with the next shot. Needs `aperture > 0` to show. */
  focusDistance?: number;
  /** Camera beats only: depth-of-field blur strength (bokeh scale). 0/omitted = sharp (no DoF). */
  aperture?: number;
  /** Camera beats only: when set, depth-of-field focus continuously tracks this object's distance from
   *  the camera each frame (auto rack-focus), overriding `focusDistance`. Needs `aperture > 0` to show. */
  focusObjectId?: string;
  /** Camera beats only (single-shot, no keyframe track): live-aim the camera at this object's position
   *  every frame, overriding `lookAt`/`rotation`. The classic "tracking shot" that follows a mover. */
  lookAtObjectId?: string;
  /** Camera beats only (single-shot, no keyframe track): ride this object — the camera sits at the
   *  followed object's position plus `followOffset` (world units) every frame, so it trails a mover.
   *  When set without an explicit `lookAt`/`lookAtObjectId`, the camera also looks at the followed object. */
  followObjectId?: string;
  /** Camera beats only: world-space offset from `followObjectId` for the follow rig (e.g. [0, 2, -6]
   *  to sit above and behind). Defaults to the beat's `position`, else [0, 0, 0]. */
  followOffset?: Vector3Tuple;
  /** Camera beats only: handheld/shake amount 0–1 layered on the final framing (deterministic noise of
   *  time, so exports are reproducible). 0/omitted = a locked-off tripod shot. */
  shake?: number;
  /** Camera beats only: handheld shake frequency (Hz-ish). Higher = jittery/nervous, lower = a slow
   *  drift/breathing camera. Defaults to ~7. */
  shakeFrequency?: number;
  /** `type: 'text'`: the on-screen copy (title card / subtitle / lower-third / credit). Fades in over the
   *  first/last ~0.4s of the beat's `duration` and holds in between. */
  text?: string;
  /** `type: 'text'`: on-screen placement/typography preset. Defaults to 'subtitle'. */
  textStyle?: CinematicTextStyle;
  /** `type: 'text'`: text color (hex). Defaults to white. */
  textColor?: string;
}

/** A film color-grade preset. `custom` = driven purely by the manual grade params below. */
export type CinematicGrade = 'none' | 'warm' | 'teal-orange' | 'noir' | 'cool' | 'sepia' | 'custom';

/**
 * The "film look" of a cinematic — applied while it plays (and while scrubbing its preview):
 * letterbox bars + film grain + vignette as a DOM layer, and a real **color grade** rendered as a
 * post-processing shader on the cinematic camera. The grade is a preset (which seeds the params
 * below) plus optional manual overrides — exposure / contrast / saturation / temperature / a custom
 * tint — scaled by `gradeIntensity`. This is what makes a starter cinematic read as a *film*.
 */
export interface CinematicLook {
  /** Letterbox target aspect ratio (e.g. 2.35 for scope, 1.85 for flat). 0/omitted = no bars. */
  letterbox?: number;
  /** Color grade preset (seeds the params below). `none`/omitted = ungraded; `custom` = params only. */
  grade?: CinematicGrade;
  /** Overall grade strength, 0–1 (mix between the original and graded image). Default 1. */
  gradeIntensity?: number;
  /** Exposure offset in stops, ~−1..1. 0 = unchanged. Overrides the preset when set. */
  exposure?: number;
  /** Contrast, ~−1..1. 0 = unchanged. Overrides the preset when set. */
  contrast?: number;
  /** Saturation, −1 (grayscale) .. 1 (boosted). 0 = unchanged. Overrides the preset when set. */
  saturation?: number;
  /** Color temperature, −1 (cool/blue) .. 1 (warm/orange). 0 = neutral. Overrides the preset when set. */
  temperature?: number;
  /** Custom tint color (hex) multiplied into the image by `tintAmount`. Overrides the preset when set. */
  tint?: string;
  /** Strength of the custom `tint`, 0–1. 0/omitted = no tint. */
  tintAmount?: number;
  /** Film-grain strength, 0–1. 0/omitted = clean. */
  grain?: number;
  /** Extra darkened-edge vignette, 0–1, on top of any project vignette. 0/omitted = none. */
  vignette?: number;
  /** Camera motion blur (shutter) strength, 0–1. Reprojects the depth buffer against the previous
   *  frame's camera to blur along screen-space camera motion — pans/dollies smear like real film.
   *  0/omitted = no blur. Applied as a post pass on the cinematic camera. */
  motionBlur?: number;
  /** Chromatic aberration, 0–1: RGB channel separation toward the frame edges (lens fringing / sci-fi
   *  look). 0/omitted = none. Post pass on the cinematic camera. */
  chromaticAberration?: number;
  /** Anamorphic bloom streak, 0–1: bright highlights smear into a horizontal lens flare streak (the
   *  signature neon-cinema look), tinted faintly blue. 0/omitted = none. Post pass. */
  anamorphic?: number;
  /** Light-leak / film-burn overlay, 0–1: warm drifting streaks of light bleeding across the frame
   *  (analog projector feel). 0/omitted = none. Rendered as a DOM overlay over the frame. */
  lightLeak?: number;
  /** Lens dirt, 0–1: procedural smudges/specks on the "lens" that light up where bright neon/highlights
   *  hit them (grime catching the bloom). 0/omitted = clean. Post pass on the cinematic camera. */
  lensDirt?: number;
}

export interface CinematicSequence {
  id: string;
  name: string;
  duration: number;
  /** Timeline display/evaluation frame rate for snapping and frame stepping. Defaults to 24. */
  frameRate?: number;
  /** Folder/path label in the Cinematics panel, e.g. "Intros/Boss". */
  folder?: string;
  /** Source sequence id when this is a duplicated take. */
  takeOf?: string;
  /** Human take number; duplicate-take creation increments it. */
  takeNumber?: number;
  autoplay?: boolean;
  skippable?: boolean;
  markers?: CinematicMarker[];
  /** The film look (letterbox / grade / grain / vignette) layered over the frame while this plays. */
  look?: CinematicLook;
  actions: CinematicAction[];
  createdAt: number;
}

export interface RuntimeCinematicCamera {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  /** Live depth-of-field focus distance (world units ahead of camera). Drives the DoF post effect. */
  focusDistance?: number;
  /** Live depth-of-field bokeh scale. 0/omitted = no DoF this frame. */
  aperture?: number;
}

export interface RuntimeCinematicFade {
  opacity: number;
  color: string;
  /** When set, render the fade as a directional wipe (colour edge sweeping in) rather than uniform opacity;
   *  `opacity` is then the wipe coverage (0 = uncovered, 1 = fully covered). */
  wipe?: 'left' | 'right' | 'up' | 'down';
}

/** A text overlay (title/subtitle/lower-third/credit) currently on screen, with its faded-in opacity. */
export interface RuntimeCinematicText {
  id: string;
  text: string;
  style: CinematicTextStyle;
  color: string;
  opacity: number;
}

export interface RuntimeCinematicState {
  sequenceId: string;
  time: number;
  firedActionIds: string[];
  spawnedObjectIds: string[];
}

