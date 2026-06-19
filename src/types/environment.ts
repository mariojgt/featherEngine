import type { Vector3Tuple } from './common';
import type { CinematicLook } from './cinematics';

export interface ScriptGraphComponent {
  blueprintId: string;
  graphId: string;
  enabled: boolean;
}

/**
 * Attaches this object to a bone "socket" of another object's animated skeleton (Unreal-style).
 * The object's own `transform` becomes the local offset from the bone, so it follows the bone as
 * the character animates — e.g. a sword in the right-hand bone. Target must render a skinned model.
 */
export interface AttachmentComponent {
  /** Object id of the skinned character to attach to. */
  targetObjectId: string;
  /** Bone name on the target's skeleton (the socket). */
  boneName: string;
  /** Optional named socket (on the target's Skeleton asset) — its offset is applied before this object's. */
  socketName?: string;
  /** Explicit local attach offset from the bone/socket — used to seat the weapon in the hand. When set it
   *  OVERRIDES the object's own transform as the offset, so a runtime-spawned weapon carries its grip
   *  alignment with it. Rotation is radians (XYZ). */
  offsetPosition?: Vector3Tuple;
  offsetRotation?: Vector3Tuple;
  offsetScale?: Vector3Tuple;
}

/** Configurable light on a `kind: 'light'` object. Defaults (no component) render as a directional light. */
export interface LightComponent {
  type: 'directional' | 'point' | 'spot';
  color: string;
  intensity: number;
  /** point/spot falloff distance in world units (0 = no falloff limit). */
  distance: number;
  /** spot cone half-angle in radians (ignored for point/directional). */
  angle: number;
  castShadow: boolean;
}

/**
 * Project-wide rendering / post-processing settings (bloom, vignette). Serialized in the manifest and
 * editable in the editor; the AI can tune them too. Read by the GameView + editor viewport post-FX pass.
 */
export interface RenderSettings {
  bloomEnabled: boolean;
  /** Bloom strength (0–3+). */
  bloomIntensity: number;
  /** Luminance threshold above which pixels bloom (0–1). Lower = more glows. */
  bloomThreshold: number;
  /** Bloom smoothing/spread (0–1). */
  bloomRadius: number;
  vignetteEnabled: boolean;
  /** GTA-style minimap/radar overlay (src/ui/MiniMap.tsx). When on, a circular radar draws the player at
   *  center, building footprints (objects with a `minimapShape` instance var) and colored blips (objects
   *  with a `minimapBlip` color var), plus health/armor arcs + a money readout from the player's vars. */
  minimapEnabled?: boolean;
  /** Rotate the radar with the player's heading (GTA-style). False = north-up. */
  minimapRotate?: boolean;
  /** World-units half-extent the radar shows around the player (default ~60). */
  minimapRange?: number;
  /** Unreal-style scalability preset (Low/Medium/High/Epic). Drives render resolution (DPR), shadow
   *  count + map size, post-FX MSAA, and bloom mip blur via the profiles in `src/three/quality.ts`.
   *  Changeable on the viewport, by the AI, and from the "Set Quality" Blueprint node. */
  quality?: QualityLevel;
  /** When on (default), sustained low framerate during Play auto-steps `quality` down (and back up as
   *  headroom returns) — never above the user's chosen preset; the editor restores it on Stop. */
  autoQuality?: boolean;
  /** When on (default), imported model textures are transcoded to GPU-compressed KTX2 on import —
   *  cuts VRAM ~6–8× and shrinks the exported game. Turn off to keep textures byte-for-byte
   *  (lossless) at the cost of more GPU memory. See `src/three/compressTextures.ts`. */
  compressTextures?: boolean;
  /** Optional project-wide color grade applied in the normal game/editor render, separate from cinematic looks. */
  colorGrade?: CinematicLook;
}

/** Game quality / scalability preset, Low → Epic (the project-wide rendering budget). */
export type QualityLevel = 'Low' | 'Medium' | 'High' | 'Epic';

export type SkyMode = 'color' | 'procedural' | 'image';

/**
 * Scene-level sky, fog and base lighting. This is the lightweight "world settings" layer:
 * procedural/color sky works without external files, while image mode can use an imported panorama.
 */
export interface SceneEnvironmentSettings {
  skyMode: SkyMode;
  /** Fallback / flat sky color. Also clears the renderer behind procedural/image sky domes. */
  backgroundColor: string;
  /** Procedural sky upper hemisphere. */
  skyTopColor: string;
  /** Procedural sky horizon band. */
  skyHorizonColor: string;
  /** Procedural sky lower hemisphere / ground bounce tint. */
  skyGroundColor: string;
  /** Equirectangular panorama image asset used when skyMode is "image". */
  skyTextureAssetId?: string;
  /**
   * Optional equirectangular image asset used as the image-based lighting (IBL) source — real
   * reflections + ambient light sampled from a panorama/HDRI. When set it replaces the built-in
   * studio Lightformer rig. Independent of `skyMode`, so the visible sky and the lighting source can
   * differ (e.g. procedural sky on screen, HDRI driving reflections). Cleared = studio default.
   */
  environmentMapAssetId?: string;
  /** Sky dome yaw in degrees. */
  skyRotation: number;
  /** Strength of the built-in ambient/environment light rig. */
  environmentIntensity: number;
  /** Directional sun color. */
  sunColor: string;
  /** Directional sun strength. */
  sunIntensity: number;
  /** Sun compass angle in degrees. */
  sunAzimuth: number;
  /** Sun height in degrees. */
  sunElevation: number;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /**
   * Unreal-style raymarched volumetric fog (src/three/VolumetricFog.tsx), layered on top of (and
   * replacing) the flat linear `fog*` haze. A depth-buffer post pass that adds height-based density,
   * sun in-scattering (the bright "glow" toward the sun) and — on Epic — god-ray light shafts where
   * geometry occludes the sun. Disabled on the Low quality preset regardless of this flag.
   */
  volumetricFogEnabled?: boolean;
  /** Overall fog extinction/density (per world unit). Higher = thicker. */
  volumetricFogDensity?: number;
  /** Scattering/fog tint (ambient color of the medium). */
  volumetricFogColor?: string;
  /** World Y where density starts falling off. */
  volumetricFogHeight?: number;
  /** Exponential height falloff rate above `volumetricFogHeight` (0 = uniform with height). */
  volumetricFogFalloff?: number;
  /** Henyey–Greenstein anisotropy g (−1..1). Positive forward-scatters toward the sun (stronger glow). */
  volumetricScattering?: number;
  /** Strength of sun in-scattering / light shafts. */
  volumetricSunStrength?: number;
  /** Raymarch far clamp in world units (caps cost + keeps distant fog bounded). */
  volumetricMaxDistance?: number;
  /**
   * Global wind as a world-space force vector. Drives every cloth sheet (added on top of each cloth's
   * own wind) and pushes DYNAMIC physics bodies scaled by their `physics.windInfluence`. [0,0,0] = calm.
   */
  wind?: Vector3Tuple;
  /** Random gust turbulence layered on the global wind, 0–1. */
  windTurbulence?: number;
  /**
   * Camera/film tonemapping operator applied to the HDR scene on its way to the screen — the single
   * biggest lever on the overall "look". `aces` (default) is the punchy filmic curve three.js has
   * always used here; `agx` is the modern, highlight-preserving curve (Blender 4's default) that
   * desaturates bright colors gracefully instead of clipping them to white; `neutral` is Khronos PBR
   * Neutral (accurate, minimal grade — good for product/UI); `reinhard`/`cineon` are classic curves;
   * `linear` and `none` disable filmic shaping. Per scene so each level can set its own mood.
   */
  toneMapping?: ToneMappingMode;
  /** Exposure multiplier applied before tonemapping (stops of light). 1 = neutral; >1 brighter, <1 darker. */
  toneMappingExposure?: number;
  /**
   * Ambient fill model. `flat` (default) is a single constant ambient term — the legacy look. `hemisphere`
   * grades the fill from the sky color overhead to the ground color below, so undersides read cooler/darker
   * and tops catch the sky — a more natural, free lighting lift.
   */
  ambientMode?: 'flat' | 'hemisphere';
  /** Soft grounding shadow blob under objects (drei ContactShadows). Default on. Turn off for flying/space scenes. */
  contactShadows?: boolean;
  /** World Y the contact-shadow plane sits at (match your ground height). Default 0. */
  contactShadowY?: number;
  /** Footprint size of the contact-shadow plane in world units. Default 14; raise for big scenes. */
  contactShadowScale?: number;
  /** Darkness of the contact shadow, 0–1. Default 0.36. */
  contactShadowOpacity?: number;
}

/** Film/camera tonemapping operators. See `SceneEnvironmentSettings.toneMapping`. */
export type ToneMappingMode = 'aces' | 'agx' | 'neutral' | 'reinhard' | 'cineon' | 'linear' | 'none';

/** A reusable named attach point on a skeleton (Unreal socket): a bone + a local offset. */
export interface SkeletonSocket {
  id: string;
  name: string;
  boneName: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
}

/** Anchors a world-space UI document above/around an object (Unreal widget-component style). */
export interface UIComponent {
  /** Id of the `surface: 'world'` UI document to render at this object. */
  documentId: string;
  /** Local offset from the object's origin, in world units. */
  offset: Vector3Tuple;
  /** Uniform scale of the rendered widget. */
  scale: number;
  /** When true the widget always faces the camera. */
  billboard: boolean;
  /**
   * Diegetic mode (requires the document's `renderMode: 'webgl'`): instead of a floating widget,
   * render the UI onto a flat in-world surface (a monitor/terminal/screen) via render-to-texture,
   * lit and oriented by the host object's transform. `surfaceWidth`/`surfaceHeight` are the panel's
   * size in world units (default 1.6 × 0.9).
   */
  diegetic?: boolean;
  surfaceWidth?: number;
  surfaceHeight?: number;
}

/**
 * Renders this object as a first-person camera-space view model for its owner.
 * The object's transform is interpreted as local camera offset/rotation/scale, not world transform.
 */
export interface ViewModelComponent {
  ownerObjectId: string;
}

