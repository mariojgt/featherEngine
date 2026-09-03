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
  /**
   * Spot cone edge softness, 0..1 (ignored for point/directional). 0 is a hard-edged cone; higher
   * values feather the falloff toward the rim. Optional so projects saved before it was exposed keep
   * the 0.45 the renderer previously hardcoded.
   */
  penumbra?: number;
  castShadow: boolean;
}

/**
 * A LOCAL reflection probe attached to any object. It captures the surrounding scene into a cubemap at
 * the object's position and feeds that cubemap as the reflection/environment map for every mesh within
 * `radius` — so metallic/glossy surfaces in this area reflect their real local surroundings (a room's
 * walls, nearby props) instead of only the single global scene environment. This is the Unity Reflection
 * Probe / Unreal Sphere Reflection Capture equivalent. When several probes overlap, the NEAREST one wins.
 */
export interface ReflectionProbeComponent {
  enabled: boolean;
  /** Influence radius in world units — meshes whose center is within this sphere use this probe's cubemap. */
  radius: number;
  /** Cubemap face resolution: higher = sharper reflections, more GPU cost. Typical 128 / 256 / 512. */
  resolution: number;
  /** Strength multiplier applied to reflections from this probe (maps to material envMapIntensity). */
  intensity: number;
  /** 'static' = captured a few frames after load then frozen (best for fixed scenery — near-free at runtime);
   *  'realtime' = re-captured continuously on a throttle (for moving/animated surroundings — costs a scene re-render). */
  refresh: 'static' | 'realtime';
  /** Diffuse GI bounce (irradiance) strength. > 0 turns the captured cubemap into a spherical-harmonic
   *  ambient light so the environment's bounced color softly lights nearby surfaces (a red room tints
   *  objects red). NOTE: this ambient is applied scene-WIDE (three.js LightProbe has no spatial falloff),
   *  so it's intended as one-per-scene/area. 0 = off (reflections only). */
  giIntensity?: number;
  /** Bump this to force a static probe to re-bake (any value change re-triggers the capture). */
  bakeNonce?: number;
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
  /**
   * The art-direction "Render Look" currently applied (see RENDER_PRESETS in `src/three/presets.ts`).
   * A look bundles tonemapping + ambient fill (per scene) with bloom shape + color grade (project-wide)
   * into one coherent style — the top-level visual identity lever, layered on top of the scene lighting.
   * `undefined` = no named look (legacy projects, or the user has hand-tuned away from every preset).
   */
  renderPreset?: RenderPresetId;
}

/** Game quality / scalability preset, Low → Epic (the project-wide rendering budget). */
export type QualityLevel = 'Low' | 'Medium' | 'High' | 'Epic';

/**
 * A named art-direction "Render Look" (see RENDER_PRESETS). `spline-studio` is the Feather default —
 * a polished, softly lit 3D-product look. The others cover common target aesthetics for a slice.
 */
export type RenderPresetId =
  | 'spline-studio'
  | 'stylized-nature'
  | 'realistic'
  | 'soft-anime'
  | 'moody-cinematic'
  | 'vibrant-arcade';

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
  /**
   * When on, Play advances `dayCycleTime` and drives sun/sky colors from a built-in day ramp
   * (Cubelands-style day/night). Authored sunElevation/sunColor remain the editor preview when the
   * cycle is off, and the starting snapshot when it turns on.
   */
  dayCycleEnabled?: boolean;
  /** Real seconds for a full 0→1 day loop while Playing. Default 360 (~6 minutes). */
  dayCycleDuration?: number;
  /**
   * Normalized time of day in [0, 1): 0 = midnight, 0.25 ≈ sunrise, 0.5 = noon, 0.75 ≈ sunset.
   * Scrubbed in Scene Settings; advanced automatically in Play when dayCycleEnabled.
   */
  dayCycleTime?: number;
  fogEnabled: boolean;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  /**
   * Atmospheric (sky-sampled) fog. Instead of a flat linear `fog*` haze, the distance fog switches to an
   * exponential aerial-perspective curve whose COLOR is auto-derived from the sky (the procedural horizon
   * tint), so distant hills/mountains dissolve seamlessly into the sky — the signature stylized-outdoors
   * look (BOTW/Genshin). `fogFar` still sets the range (bigger = clearer). Ignored when volumetric fog is
   * on (that pass owns the haze). Off = the classic linear `fog*` behaviour.
   */
  atmosphericFog?: boolean;
  /**
   * Aerial perspective (src/three/aerialFog.ts) — layers height falloff and sun in-scattering onto
   * whichever fog model is active, so haze pools in valleys, thins with altitude, and warms toward the
   * sun. Stacks with `atmosphericFog`: that one picks the fog's base color and distance curve, this one
   * adds the vertical gradient and the warm glow toward the sun, so they are usually enabled together.
   * This is the cheap always-on layer that works in the editor viewport too; it is independent of
   * `volumetricFogEnabled`, which is a raymarched post-pass that only runs during Play.
   */
  aerialFogEnabled?: boolean;
  /** Density falloff per world unit of height. 0 = uniform. ~0.02 gives valley haze / clear peaks. */
  aerialFogHeightFalloff?: number;
  /** Color the fog tints toward when looking into the sun. Defaults to a warm sunlight cream. */
  aerialFogSunColor?: string;
  /** Sun in-scatter strength, 0–1. 0 disables the warm tint entirely. */
  aerialFogInscatter?: number;
  /** In-scatter exponent — higher tightens the glow to a smaller halo around the sun. ~6 is a broad wash. */
  aerialFogInscatterPower?: number;
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
   * World gravity as an acceleration vector (units/s²) for the whole scene. Undefined = Earth,
   * `[0, -9.81, 0]`. Drop the magnitude for Moon/low-g levels, zero it for space, or point it
   * sideways/up for a gimmick level — every dynamic body scales it by its own `gravityScale`,
   * and `gravityMultiplier` trigger volumes still layer on top per-body.
   */
  gravity?: Vector3Tuple;
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
  /** Edge softness for the contact shadow. Default 2.4; larger values make a broader studio-style falloff. */
  contactShadowBlur?: number;
  /** Vertical capture distance for contact casters. Default 6 world units. */
  contactShadowFar?: number;
  /** Contact-shadow tint. Default black; a near-black scene hue gives softer color integration. */
  contactShadowColor?: string;
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
