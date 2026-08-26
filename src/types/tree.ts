/**
 * Parametric tree specs.
 *
 * A tree is stored as a SPEC ID + SEED, never as baked geometry: the mesh is regenerated from a
 * deterministic PRNG whenever it is needed. That keeps a 500-tree forest at a few hundred bytes in the
 * project file, lets one spec edit restyle every instance at once, and guarantees the same seed always
 * produces the identical tree (so saves, replays and multiplayer peers agree).
 *
 * Parameter naming follows Weber-Penn / Blender's Sapling where there is an established name, so anyone
 * who has used those tools can find their way around.
 */

/** Broad shape family. Archetypes are PARTIAL overrides on a shared base, so a birch can be dragged all
 *  the way to a willow without hitting a wall between "types". */
export type TreeArchetype = 'conifer' | 'broadleaf' | 'birch' | 'willow' | 'palm' | 'shrub' | 'snag';

/**
 * How a canopy is built out of geometry.
 *
 * `clusters` is the stylized Unreal/Fortnite path: overlapping soft blobs packed into a crown
 * ellipsoid so the silhouette reads as one volume rather than confetti on branch tips.
 */
export type TreeFoliageStrategy = 'blob' | 'cards' | 'clusters' | 'skirt' | 'fronds' | 'strands' | 'none';

/**
 * Painted leaf silhouettes available to pixel-art canopies.
 *
 * These are construction languages rather than species names: several species can share a fine,
 * airy leaf while keeping different trunks, branching habits and colour palettes.
 */
export type TreePixelLeafArt =
  | 'broad'
  | 'star'
  | 'fine'
  | 'blossom'
  | 'jungle'
  | 'ribbon'
  | 'needle'
  | 'pod'
  | 'quill';

export interface TreePixelArtSpec {
  /** Off for ordinary parametric trees; on uses the procedural cutout atlas on foliage cards. */
  enabled: boolean;
  /** The painted silhouette family sampled by every canopy card. */
  leafArt: TreePixelLeafArt;
  /** Alpha-test threshold. A cutout stays in the opaque render queue and casts crisp shadows. */
  alphaCutoff: number;
  /** Rebuild cards in camera space so no part of the canopy turns edge-on. */
  billboard: boolean;
}

export interface TreeTrunkSpec {
  /** World units, 1–30. */
  height: number;
  baseRadius: number;
  /** 0–1 radius falloff toward the tip. */
  taper: number;
  /** Degrees off vertical. */
  lean: number;
  /** 0–1 S-curve amount along the height. */
  curl: number;
  heightSegments: number;
  radialSegments: number;
  /** 0–1 root flare at the base. */
  flare: number;
  /**
   * 0–1 bark radius noise (Unreal/SpeedTree-style gnarl). Breaks the extruded-pipe look without
   * needing a bark texture — especially visible on stylized trunks at mid distance.
   */
  gnarl: number;
}

export interface TreeBranchSpec {
  /** 0–3. Past 3 the triangle count explodes for no visual gain at normal viewing distances. */
  levels: number;
  countPerLevel: number[];
  /** 0–1 fraction along the parent before branching begins. */
  startHeight: number;
  endHeight: number;
  /** Degrees from the parent direction. */
  angle: number;
  angleVariance: number;
  /** Child length / parent length. */
  lengthRatio: number;
  radiusRatio: number;
  /** -1 droop … 0 straight … +1 reach up. */
  gravity: number;
  /** Degrees between successive branches. 137.5 is the golden-angle phyllotaxis that real plants use. */
  twist: number;
  curlPerLevel: number;
}

export interface TreeFoliageSpec {
  strategy: TreeFoliageStrategy;
  /** Clusters per branch tip, or ring count for the skirt strategy. */
  density: number;
  size: number;
  sizeVariance: number;
  /** 0–1. */
  droop: number;
  /**
   * Relative crown width (× trunk height). Drives the ellipsoid canopy volume used by blob /
   * cards / clusters — the Unreal-style "paint the crown, not the twigs" placement.
   */
  crownRadius: number;
  /** 0–1 height of the crown centre along the trunk (0 = base, 1 = tip). */
  crownLift: number;
  /**
   * 0–1 mix between tip-anchored foliage and crown-volume fill. 0 = classic tip scatter,
   * 1 = full ellipsoid packing (best for stylized broadleaf silhouettes).
   */
  crownFill: number;
  skirtRings?: number;
  /** Radial noise on the cone's lower edge — a clean rim reads as a traffic cone, not a pine. */
  skirtJagged?: number;
  cardsPerCluster?: number;
  strandLength?: number;
  frondCount?: number;
}

export interface TreeLookSpec {
  /** Bark colour ramp, root → tip. */
  barkRamp: string[];
  /** Foliage colour ramp, interior → outer. */
  foliageRamp: string[];
  translucency: { color: string; scale: number; power: number };
  /** 0–1 canopy interior darkening baked into vertex colour. */
  aoStrength: number;
  /** Optional-looking in old project files, but normalization always supplies a complete value. */
  pixelArt: TreePixelArtSpec;
}

export interface TreeWindSpec {
  /** Exponent on distance-from-root. ~1.6 keeps the trunk stiff while twigs whip. */
  stiffnessCurve: number;
  /** 0–1 multiplier holding the base planted. */
  trunkStiffness: number;
  levelMultiplier: number[];
}

export interface TreeLodSpec {
  levels: number;
  distances: number[];
  /** 0 disables billboards. */
  billboardDistance: number;
}

/**
 * A height along the trunk where the tree can be severed (Zelda-style felling).
 *
 * Authored on the SPEC rather than per instance so every pine in a forest chops the same way, and so the
 * break heights stay meaningful when the spec's trunk height changes (they are fractions, not metres).
 */
export interface TreeBreakPoint {
  /** 0 = ground, 1 = top of the trunk. */
  height: number;
  /** Axe hits needed to sever here. */
  hits: number;
  /** Label shown on the break-point handle in the Tree Builder (e.g. "stump", "log 1"). */
  label?: string;
}

export interface TreeChopSpec {
  /** When false the tree is scenery — hits do nothing. */
  enabled: boolean;
  /** Sorted ascending by height. The first is normally the felling cut near the base. */
  breakPoints: TreeBreakPoint[];
  /** How close (world units, measured along the trunk) a hit must land to count for a break point. */
  tolerance: number;
  /** Impulse applied to the severed piece so it topples away from the chop instead of dropping straight down. */
  topplePush: number;
  /** Seconds before a felled log despawns. 0 = never. */
  logLifetime: number;
}

export interface TreeSpec {
  id: string;
  name: string;
  archetype: TreeArchetype;
  trunk: TreeTrunkSpec;
  branches: TreeBranchSpec;
  foliage: TreeFoliageSpec;
  look: TreeLookSpec;
  wind: TreeWindSpec;
  lod: TreeLodSpec;
  chop: TreeChopSpec;
}

/**
 * A tree placed in a scene. Geometry comes from `spec` + `seed` and is never stored — a whole forest costs
 * a few hundred bytes, and the same seed always rebuilds the identical mesh.
 *
 * The spec is currently held INLINE (the ParticleSystemComponent shape, before its `systemId` existed).
 * `specId` is reserved for the shared project-level tree-asset library: once that lands, a set id resolves
 * against it and inline `spec` becomes the per-object override, so nothing authored now has to change.
 */
export interface TreeComponent {
  enabled: boolean;
  spec: TreeSpec;
  seed: number;
  /** Reserved — id of a shared project tree asset once the tree-asset library exists. */
  specId?: string;
  /** 0–1 per-instance hue/value jitter so a stand of one spec still varies. */
  tintJitter?: number;
  /** Per-instance override: false makes this particular tree unchoppable even if its spec allows it. */
  choppable?: boolean;
}

/**
 * Live felling progress. Runtime-only — never serialized, and wiped by Stop along with everything else in
 * the Play snapshot, so a chopped forest is whole again the moment you stop.
 */
export interface TreeChopState {
  /** Remaining hits per break-point index. Absent = untouched. */
  hitsLeft: Record<number, number>;
  /** Break-point index this trunk has already been severed at, if any. */
  severedAt?: number;
}
