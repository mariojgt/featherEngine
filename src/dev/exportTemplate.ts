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
 * Assets are emitted as EXTERNAL references (url + sha256), not inlined base64 — that's the whole
 * point of the exercise: the third-person template's 22 MB character would otherwise become ~29 MB
 * of JSON in a single unstreamable document.
 */

type TemplateKey =
  | 'third-person'
  | 'first-person'
  | 'driving'
  | 'sim-racing'
  | 'cinematic'
  | 'meadows'
  | 'cube-realm'
  | 'platformer'
  | 'physics-lab'
  | 'timeline-mechanics'
  | 'spline-studio';

interface TemplateDef {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  build: () => Promise<unknown>;
}

const TEMPLATES: Record<TemplateKey, TemplateDef> = {
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
  cinematic: {
    slug: 'template-cinematic',
    title: 'The Summit',
    description: 'A cloth-and-wind mountain film set with a full cinematic sequence to play back.',
    tags: ['template', 'world', 'cinematic', 'film'],
    build: async () => (await import('../project/filmModeTemplate')).createFilmModeTemplate(),
  },
  meadows: {
    slug: 'template-meadows',
    title: 'Meadows',
    description: 'Stylized BOTW-style grass, wildflowers and trees to walk through.',
    tags: ['template', 'world', 'vegetation', 'outdoor'],
    build: async () => (await import('../project/meadowTemplate')).createMeadowTemplate(),
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
  'cube-realm': {
    slug: 'template-cube-realm',
    title: 'Cube Realm',
    description: 'An action slice with a combo system, day cycle and a shrine to find.',
    tags: ['template', 'world', 'action'],
    build: async () => (await import('../project/cubeRealmTemplate')).createCubeRealmTemplate(),
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
 * from `public/` and then hand the bytes to the platform importer, which loses the original path —
 * matching on hash afterwards recovers it without touching any template code.
 */
function captureAssetSources(): { sources: Map<string, string>; restore: () => void } {
  const sources = new Map<string, string>();
  const original = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input, init);
    const url = input instanceof Request ? input.url : String(input);
    if (response.ok && BINARY.test(url)) {
      // Clone so the template still gets an unread body.
      response
        .clone()
        .arrayBuffer()
        .then(async (buffer) => {
          sources.set(await sha256Hex(buffer), new URL(url, document.baseURI).pathname.replace(/^\//, ''));
        })
        .catch(() => undefined);
    }
    return response;
  };
  return { sources, restore: () => { window.fetch = original; } };
}

/**
 * Read a live project asset's bytes back out, hash them, and recover the public path they came from.
 * The bytes go INTO the archive; `source` is kept alongside as a fallback for manifest-only reads.
 */
async function toPackagedAsset(
  asset: AssetItem,
  sources: Map<string, string>,
): Promise<{ asset: AssetItem; bytes: Uint8Array } | null> {
  if (!asset.url) return null;
  const response = await fetch(asset.url);
  const buffer = await response.arrayBuffer();
  const hash = await sha256Hex(buffer);
  const url = sources.get(hash);
  if (!url) {
    console.warn(`[template-export] no public source for "${asset.name}" — skipping`);
    return null;
  }
  return {
    asset: {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      size: buffer.byteLength,
      hash,
      createdAt: asset.createdAt,
      source: { url, sha256: hash, bytes: buffer.byteLength },
    },
    bytes: new Uint8Array(buffer),
  };
}

async function run(key: TemplateKey) {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown template "${key}". Try: ${Object.keys(TEMPLATES).join(', ')}`);

  const { sources, restore } = captureAssetSources();
  try {
    console.info(`[template-export] building "${def.title}"…`);
    await useProjectStore.getState().newProject(def.title);
    await def.build();

    const editor = useEditorStore.getState();
    const collected = editor.buildProjectPackage();
    const live = editor.assets.filter((asset) => collected.assetIds.includes(asset.id));
    const packaged = (await Promise.all(live.map((asset) => toPackagedAsset(asset, sources)))).filter(
      (entry): entry is { asset: AssetItem; bytes: Uint8Array } => !!entry,
    );

    const pkg = buildPackage('project', collected.content, packaged.map((entry) => entry.asset), {
      id: `pkg-feather-${def.slug}`,
      name: def.title,
      description: def.description,
      author: 'Feather',
      version: '1.0.0',
      tags: def.tags,
    });

    // One file: manifest + every asset, compressed. This is what gets published and downloaded.
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
