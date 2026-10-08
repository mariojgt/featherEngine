import { useProjectStore } from '../store/projectStore';
import { useEditorStore } from '../store/editorStore';
import { buildPackage } from '../project/package';
import { writePackageArchive } from '../project/packageArchive';
import { sha256Hex } from '../utils/contentHash';
import type { AssetItem } from '../types';

/**
 * DEV-only: convert a built-in starter template into a `kind: 'project'` `.nfpack`.
 *
 * The templates are imperative builders that fetch real multi-megabyte models and go through the
 * platform asset pipeline, so running them anywhere but a real browser would be an emulation of the
 * thing rather than the thing. This runs the actual builder, snapshots the resulting project, and
 * POSTs the package to the dev-server sink in vite.config.ts.
 *
 * Every referenced asset is embedded as binary bytes in the archive. Recovered source URLs are
 * optional provenance/fallback metadata; installing the archive never needs the original server.
 */

type TemplateKey =
  | 'cinematic'
  | 'neon-afterlight'
  | 'cinderfall'
  | 'third-person'
  | 'first-person'
  | 'driving'
  | 'sim-racing'
  | 'crystal-slice'
  | 'last-light'
  | 'blackthorn'
  | 'verdant'
  | 'cube-rpg'
  | 'platformer'
  | 'parcel-panic'
  | 'moba'
  | 'tower-defense'
  | 'physics-lab'
  | 'timeline-mechanics'
  | 'spline-studio';

interface TemplateDef {
  slug: string;
  title: string;
  version?: string;
  description: string;
  tags: string[];
  build: () => Promise<unknown>;
}

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
  // Retired from the public catalog; these keys still serve the documented authoring/capture CLI.
  cinematic: {
    slug: 'template-cinematic', title: 'Resonance — Kinetic Hall',
    description: 'An editable kinetic hall film with cameras, lighting and live mechanics.',
    tags: ['template', 'cinematic', 'authoring'],
    build: async () => (await import('../project/filmModeTemplate')).createFilmModeTemplate(),
  },
  'neon-afterlight': {
    slug: 'template-neon-afterlight', title: 'Neon Afterlight', version: '1.1.0',
    description: 'An editable seventy-second district film with an embedded city kit and original score.',
    tags: ['template', 'cinematic', 'authoring', 'cyberpunk'],
    build: async () => (await import('../project/neonAfterlightTemplate')).createNeonAfterlightTemplate(),
  },
  cinderfall: {
    slug: 'template-cinderfall',
    title: 'Cinderfall — Extraction FPS',
    version: '1.0.0',
    description: 'An original single-player sci-fi cave expedition: recover sixteen aetherite units, fight eight articulated cave creatures, and return to the amber extraction rig. Includes an editable VX-24 rifle, timed magazine reloads, a headlamp, responsive briefing/HUD/pause/results, replay, original synthesized audio, reusable Model Forge assets and editable FeatherScript gameplay. Requires a Feather build with Model Forge camera view-model support.',
    tags: ['template', 'world', 'fps', 'mining', 'extraction', 'sci-fi', 'caves', 'editable'],
    build: async () => (await import('../project/cinderfallTemplate')).createCinderfallTemplate(),
  },
  'crystal-slice': {
    slug: 'template-crystal-slice',
    title: 'Crystal Slice',
    description: 'Runtime mesh cutting: a chrome blade slices one solid turquoise block into colliding rigid bodies that tumble into water. A twelve-second machine cycle replenishes stock under a fade.',
    tags: ['template', 'world', 'cinematic', 'loop', 'glass', 'water', 'studio'],
    build: async () => (await import('../project/crystalSliceTemplate')).createCrystalSliceTemplate(),
  },
  'cube-rpg': {
    slug: 'template-cube-rpg',
    title: 'Cube RPG — The Skyward Trials',
    version: '1.2.0',
    description: 'A playable cube knight adventure: equip a sword and shield, chain a 3-hit combo into a spinning finisher, plunge into ground slams, block committed telegraphed attacks, use potions and conquer three floating arenas with a final boss. Animated strides, wind-ups, hurt faces, recoil, material flashes, impact stars and camera kicks give combat weight. Asset-free stylized scenery, editable VFX, a reusable character prefab, HUD and complete adventure menus.',
    tags: ['template', 'world', 'rpg', 'combat', 'stylized', 'beginner', 'cube', 'vfx'],
    build: async () => (await import('../project/cubeRpgTemplate')).createCubeRpgTemplate(),
  },
  verdant: {
    slug: 'template-verdant',
    title: 'Verdant — A Woodland Study',
    version: '1.1.0',
    description: 'An original 48-second woodland cinematic: rocky clearings, fern and shrub banks, natural blade grass, clustered authored trees and volumetric sunlight. Six editable shots, an original generated score and ambience. A local reusable project package. Play; R replays.',
    tags: ['template', 'world', 'cinematic', 'film', 'woodland', 'forest', 'terrain', 'grass', 'trees', 'understory', 'nature'],
    build: async () => (await import('../project/verdantTemplate')).createVerdantTemplate(),
  },
  'third-person': {
    slug: 'template-third-person',
    title: 'Third Person Starter',
    description:
      'A playable third-person character with follow camera, melee and ranged weapons, and a six-room tutorial corridor to explore.',
    tags: ['template', 'world', 'character', 'third-person'],
    build: async () => (await import('../project/thirdPersonTemplate')).createThirdPersonTemplate(),
  },
  'first-person': {
    slug: 'template-first-person',
    title: 'First Person Shooter',
    description: 'Neon cyberpunk FPS starter: guns, grenades, explosive barrels and enemies.',
    tags: ['template', 'world', 'fps', 'shooter'],
    build: async () => (await import('../project/firstPersonTemplate')).createFirstPersonTemplate(),
  },
  driving: {
    slug: 'template-driving',
    title: 'Driving',
    description: 'NFS-lite neon night cruise with cash orbs, nitro pads and a garage upgrade loop.',
    tags: ['template', 'world', 'driving', 'vehicle'],
    build: async () => (await import('../project/drivingTemplate')).createDrivingTemplate(),
  },
  'sim-racing': {
    slug: 'template-sim-racing',
    title: 'Sim Racing',
    description: 'Realistic car physics with a torque curve, gearbox, per-wheel grip and lap timing.',
    tags: ['template', 'world', 'racing', 'vehicle'],
    build: async () => (await import('../project/simRacingTemplate')).createSimRacingTemplate(),
  },
  'last-light': {
    slug: 'template-last-light',
    title: 'Last Light',
    description: 'A 70-second film in a drowned mountain observatory. Ten camera shots, ridged landscapes, warm and cool lighting, water, wind-driven cloth, live tumbling fracture and an original score. Every shot and cue is editable; press R to replay.',
    tags: ['template', 'world', 'cinematic', 'film', 'landscape', 'lighting', 'destruction'],
    build: async () => (await import('../project/lastLightTemplate')).createLastLightTemplate(),
  },
  blackthorn: {
    slug: 'template-blackthorn',
    title: 'Blackthorn Keep',
    description: 'A complete 70-second dark fantasy film: a wind-swept grassland, modular Gothic castle, storm clouds, rain, moonlight, gate fires, simulated heraldic cloth and lightning-driven live destruction. Includes all models, materials, original music and weather sound design, ten editable shots and the storm Director Blueprint. Play the film; R replays.',
    tags: ['template', 'world', 'cinematic', 'film', 'dark-fantasy', 'castle', 'weather', 'lighting', 'physics'],
    build: async () => (await import('../project/blackthornTemplate')).createBlackthornTemplate(),
  },
  'physics-lab': {
    slug: 'template-physics-lab',
    title: 'Physics Lab',
    description: 'A rig for exploring axis locks, stay events, spin and gravity overrides.',
    tags: ['template', 'world', 'physics', 'prototyping'],
    build: async () => (await import('../project/physicsLabTemplate')).createPhysicsLabTemplate(),
  },
  'timeline-mechanics': {
    slug: 'template-timeline-mechanics',
    title: 'Timeline Mechanics',
    description:
      'A walkable curve-animation gallery with an interactive Vault Door prefab, elevator, drawbridge, security gate, crusher and chest.',
    tags: ['template', 'world', 'timeline', 'animation', 'blueprint', 'prefab'],
    build: async () => (await import('../project/timelineShowcaseTemplate')).createTimelineShowcaseTemplate(),
  },
  'spline-studio': {
    slug: 'template-spline-studio',
    title: 'Spline Studio',
    description:
      'A polished interactive 3D design stage with soft candy-plastic materials, rounded primitives, studio lighting, broad contact shadows and editable kinetic motion.',
    tags: ['template', 'world', 'design', 'spline', 'studio', 'animation'],
    build: async () => (await import('../project/splineStudioTemplate')).createSplineStudioTemplate(),
  },
  moba: {
    slug: 'template-moba',
    title: 'Lumen Lane — Astral Rift MOBA',
    version: '2.1.0',
    description: 'An original three-lane MOBA with five selectable champions: tank, jungler, mage, ranged carry and support. Point-and-click movement and combat, following camera, clickable minimap, forest paths, river crossings, jungle sentinels, allied and enemy AI, minion waves, towers, cores, abilities, recall, gold income, a six-item shop and four-slot inventory. Fully editable and playable offline.',
    tags: ['template', 'world', 'moba', 'strategy', 'heroes', 'three-lanes'],
    build: async () => (await import('../project/mobaTemplate')).createMobaTemplate(),
  },
  'parcel-panic': {
    slug: 'template-parcel-panic',
    title: 'Parcel Panic',
    version: '1.1.0',
    description:
      'A sunny delivery game with an animated robot courier and a seeded procedural village. Throw weighted, tumbling parcels into solid baskets; push crates, roll drums and bounce rubber balls. Generate a new village or retry the same route in relaxed or timed play. Includes a skippable opening cinematic and eleven reusable editable prefabs.',
    tags: ['template', 'world', 'delivery', 'arcade', 'beginner', 'primitives', 'robot'],
    build: async () => (await import('../project/parcelPanicTemplate')).createParcelPanicTemplate(),
  },
  'tower-defense': {
    slug: 'template-tower-defense',
    title: 'Sproutwatch · Garden Defense',
    description: 'A cozy procedural garden defense game with animated cartoon zombies, three upgradeable plant defenders, ten waves, a responsive HUD, pause and replay. Original editable scenery, no external assets.',
    tags: ['template', 'world', 'tower-defense', 'zombies', 'strategy', 'procedural', 'cartoon'],
    build: async () => (await import('../project/towerDefenseTemplate')).createTowerDefenseTemplate(),
  },
  platformer: {
    slug: 'template-platformer',
    title: 'Cloudstep Garden',
    description:
      'A bright primitive-built 3D platformer with a reusable live-linked Pip character prefab, expressive cartoon motion and VFX, moving clouds, Sun Seeds, three-heart checkpoint recovery and a polished responsive HUD.',
    tags: ['template', 'world', 'platformer', 'arcade', 'primitives', 'prefab', 'character'],
    build: async () => (await import('../project/platformerTemplate')).createPlatformerTemplate(),
  },
};

const BINARY = /\.(glb|gltf|fbx|mp3|wav|ogg|png|jpe?g|webp|ktx2)(\?|$)/i;

/**
 * Record where each fetched binary came from, keyed by content hash. Templates pull their assets
 * from `public/` or Vite-served `src/` files and hand them to importers or embed them as data URLs —
 * matching on hash afterwards recovers it without touching any template code.
 */
function captureAssetSources(): { sources: Map<string, string>; flush: () => Promise<void>; restore: () => void } {
  const sources = new Map<string, string>();
  const pending = new Set<Promise<void>>();
  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (response.ok && BINARY.test(url)) {
      // Clone so the template still gets an unread body.
      const task = response
        .clone()
        .arrayBuffer()
        .then(async (buffer) => {
          const source = new URL(url, document.baseURI);
          sources.set(await sha256Hex(buffer), source.origin === location.origin
            ? `${source.pathname.replace(/^\//, '')}${source.search}` : source.href);
        })
        .catch(() => undefined);
      pending.add(task);
      void task.finally(() => pending.delete(task));
    }
    return response;
  };
  return { sources, flush: async () => { await Promise.all(pending); }, restore: () => { window.fetch = original; } };
}

/**
 * Read a live project asset's bytes back out, hash them, and recover its source URL when available.
 * The bytes go INTO the archive; `source` is kept alongside as a fallback for manifest-only reads.
 */
export async function toPackagedAsset(
  asset: AssetItem,
  sources: Map<string, string>,
): Promise<{ asset: AssetItem; bytes: Uint8Array }> {
  const input = asset.url ?? asset.data;
  if (!input) throw new Error(`[template-export] missing bytes for "${asset.name}" (${asset.id})`);
  const response = await fetch(input);
  if (!response.ok) throw new Error(`[template-export] failed to read "${asset.name}" (${asset.id}): HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const url = sources.get(hash) ?? asset.source?.url;
  return {
    asset: {
      ...asset,
      url: undefined,
      data: undefined,
      path: undefined,
      delivery: undefined,
      unresolved: undefined,
      size: buffer.byteLength,
      hash,
      createdAt: asset.createdAt,
      source: url ? { url, sha256: hash, bytes: buffer.byteLength } : undefined,
    },
    bytes: new Uint8Array(buffer),
  };
}

async function run(key: TemplateKey) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown template "${key}". Try: ${Object.keys(TEMPLATES).join(', ')}`);

  const { sources, flush, restore } = captureAssetSources();
  try {
    console.info(`[template-export] building "${def.title}"…`);
    await useProjectStore.getState().newProject(def.title);
    await def.build();
    await flush();

    const editor = useEditorStore.getState();
    const collected = editor.buildProjectPackage();
    const byId = new Map(editor.assets.map((asset) => [asset.id, asset]));
    const live = collected.assetIds.map((id) => {
      const asset = byId.get(id);
      if (!asset) throw new Error(`[template-export] missing referenced asset ${id}`);
      return asset;
    });
    const packaged = await Promise.all(live.map((asset) => toPackagedAsset(asset, sources)));

    const pkg = buildPackage('project', collected.content, packaged.map((entry) => entry.asset), {
      id: `pkg-feather-${def.slug}`,
      name: def.title,
      description: def.description,
      author: 'Feather',
      version: def.version ?? '1.0.0',
      tags: def.tags,
    });

    // One reusable local file: manifest + every asset, compressed.
    const archive = writePackageArchive(pkg, new Map(packaged.map((entry) => [entry.asset.id, entry.bytes])));
    const response = await fetch(`/__feather/export-template?slug=${encodeURIComponent(def.slug)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: archive,
    });
    if (!response.ok) throw new Error(await response.text());

    const rawBytes = packaged.reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
    const summary = {
      slug: def.slug,
      scenes: collected.content.scenes?.length ?? 0,
      objects: (collected.content.scenes ?? []).reduce((sum, scene) => sum + scene.objects.length, 0),
      prefabs: collected.content.prefabs.length,
      blueprints: collected.content.blueprints.length,
      assets: packaged.length,
      skipped: live.length - packaged.length,
      rawMB: +(rawBytes / 1048576).toFixed(1),
      archiveMB: +(archive.byteLength / 1048576).toFixed(1),
    };
    console.info('[template-export] done', summary);
    // Surfaced in the DOM so a headless driver can read the result without a console bridge.
    document.body.dataset.templateExport = JSON.stringify(summary);
  } finally {
    restore();
  }
}

/**
 * Guard against a second run. React StrictMode double-invokes effects in dev, which started two
 * builders concurrently against the SAME store: they interleaved, so the captured project could
 * contain both runs' objects (a doubled world, and the same model imported twice) depending on
 * which POST landed last. Exports must be deterministic — they become shipped content.
 */
let started = false;

/** Wired from App when `?exportTemplate=<key>` is present (DEV builds only). */
export function runTemplateExport(key: string) {
  if (started) return;
  started = true;
  void run(key as TemplateKey).catch((error) => {
    console.error('[template-export] failed', error);
    document.body.dataset.templateExportError = String(error);
  });
}
