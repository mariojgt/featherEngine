#!/usr/bin/env node
/**
 * Stages the hosted asset-store catalog: a set of `.nfpack` packages plus the `catalog.json`
 * index that the Asset Store panel reads.
 *
 * The packages here are authored the same way an outside publisher would author them — plain data,
 * so this script doubles as the reference for what an upload must look like.
 * Output is byte-stable (fixed ids and timestamps) so rebuilding doesn't churn git.
 *
 * Run: npm run build:store  (vite-node, so it can share the container code in src/)
 */
import { TEMPLATE_LESSONS } from '../src/creator/templateLessons';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
// Run through vite-node so the container format has ONE implementation. A hand-rolled copy of the
// zip layout here would drift from the engine's reader the first time either changed.
import { readPackageFile, writePackageArchive } from '../src/project/packageArchive';
import { isRetiredStoreSlug } from '../src/marketplace/retiredPackages';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '.feather-cache', 'store');
const PREVIEWS_DIR = join(OUT_DIR, 'previews');
const PACKAGES_DIR = join(OUT_DIR, 'packages');

/** Subfolder per package kind — see PackageKind in src/project/package.ts. */
const KIND_DIRS = { project: 'projects', asset: 'assets', plugin: 'plugins' } as const;

const PACKAGE_FORMAT = 'nodeforge-package';
const PACKAGE_VERSION = '1.0.0';
const ENGINE_VERSION = '0.8.0'; // PROJECT_VERSION in src/types/project.ts
const CATALOG_FORMAT = 'feather-store-catalog';
/** Fixed so regenerating the catalog produces identical bytes. */
const EPOCH = Date.parse('2026-01-01T00:00:00.000Z');
const ISO = new Date(EPOCH).toISOString();

// ------------------------------------------------------------------------------------------------
// Authoring helpers — the minimum valid shape of each entity (see src/types/).
// ------------------------------------------------------------------------------------------------

/** A flat-gradient SVG card used as the store thumbnail — keeps the catalog binary-free. */
const thumbnail = (from, to, glyph) => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/>` +
    `</linearGradient></defs>` +
    `<rect width="128" height="128" rx="16" fill="url(#g)"/>` +
    `<text x="64" y="82" font-family="system-ui,sans-serif" font-size="56" font-weight="700" ` +
    `text-anchor="middle" fill="#ffffff" fill-opacity="0.92">${glyph}</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
};

/** Wrap authored content in the NodeForgePackage envelope (mirrors buildPackage in package.ts). */
const buildPackage = (meta, content, assets = [], kind = 'asset') => ({
  format: PACKAGE_FORMAT,
  formatVersion: PACKAGE_VERSION,
  kind,
  meta: { ...meta, createdAt: ISO, engineVersion: ENGINE_VERSION },
  content: {
    prefabs: [],
    blueprints: [],
    graphs: [],
    materials: [],
    particleSystems: [],
    skeletons: [],
    skeletalMeshes: [],
    animations: [],
    animatorControllers: [],
    dataAssets: [],
    uiDocuments: [],
    variables: [],
    ...content,
  },
  assets,
});

// ------------------------------------------------------------------------------------------------
// First-party editor plugins.
// ------------------------------------------------------------------------------------------------

const ARBOR_FORGE_PLUGIN = {
  slug: 'arbor-forge',
  kind: 'plugin',
  meta: {
    id: 'pkg-feather-plugin-arbor-forge',
    pluginId: 'feather.arbor-forge',
    name: 'Arbor Forge — Stylized Tree Studio',
    description:
      'Turn the parametric tree system into an art department: twelve hand-tuned stylized presets — Sakura, Autumn Maple, Ghost Willow, Ancient Oak, Baobab, Savanna Acacia, Frost Spruce and more — with a live 3D preview, a seed explorer, one-click planting and natural grove scattering. Everything it plants is an ordinary tree asset: terrain-snapped, wind-animated, choppable, and still editable in the Tree Builder afterwards.',
    author: 'Feather',
    version: '1.0.0',
    tags: ['plugin', 'trees', 'nature', 'stylized', 'environment'],
    thumbnail: thumbnail('#2FAE6B', '#0C3B24', '\u{1F333}'),
  },
  content: {},
};

/**
 * Model Forge, the second gallery plugin — same manifest-only shape as Arbor Forge above. The model
 * DATA layer (specs, rendering, serialization, AI tools) is engine code and always on; this package
 * activates the visual studio panel.
 */
const MODEL_FORGE_PLUGIN = {
  slug: 'model-forge',
  kind: 'plugin',
  meta: {
    id: 'pkg-feather-plugin-model-forge',
    pluginId: 'feather.model-forge',
    name: 'Model Forge — Prototype Modeler',
    description:
      'Create editable polygon models in Feather with Object, Edit and Paint workspaces. Shape vertices, edges and faces; extrude, inset, bevel and cut meshes; use symmetry, modifiers and UV tools; import GLB models and bake finished props with their materials and textures. Activates the Model Forge tool included in a build with Model Forge 1.2 support.',
    author: 'Feather',
    version: '1.2.0',
    tags: ['plugin', 'modeling', 'props', 'stylized', 'prototyping'],
    thumbnail: thumbnail('#E9A13B', '#4A2508', '\u{1F528}'),
  },
  content: {},
};

/** Card art for the browser-exported starter templates, which carry no thumbnail of their own. */
const TEMPLATE_THUMBNAILS = {
  'template-cube-rpg': ['#FBA06B', '#427E86', '\u{1F6E1}'],
  'template-third-person': ['#5B8CFF', '#1B2C63', '\u{1F3C3}'],
  'template-first-person': ['#FF3D6E', '#3A0C22', '\u{1F52B}'],
  'template-driving': ['#FF9F3D', '#5A2E08', '\u{1F697}'],
  'template-sim-racing': ['#E84B3C', '#4A120C', '\u{1F3C1}'],
  'template-verdant': ['#70954F', '#142A20', '\u{1F332}'],
  'template-platformer': ['#FF7196', '#236784', '\u{2600}\u{FE0F}'],
  'template-moba': ['#69D5B2', '#243B52', '⚔️'],
  'template-parcel-panic': ['#FFD166', '#269DAB', '\u{1F4E6}'],
  'template-tower-defense': ['#9CBD81', '#315347', '\u{1F331}'],
  'template-physics-lab': ['#7A8CFF', '#232C5C', '\u{1F9EA}'],
  'template-timeline-mechanics': ['#40DFFF', '#10283A', '\u{23F1}'],
  'template-spline-studio': ['#9B7BFF', '#241A38', '\u{2728}'],
};

/**
 * Install footprint = the archive, because the archive IS the download: manifest and every asset in
 * one compressed file. Identical bytes referenced under two ids are stored once by the container,
 * so this needs no deduplication of its own.
 */
const installFootprint = (archiveBytes) => archiveBytes;

/**
 * Refuse to list a package built from a doubled project.
 *
 * Template packages come out of a browser run, and a re-entrant export once merged two builds into
 * one file: every object duplicated at an identical transform, every model imported twice. It
 * installed fine and looked plausible. Identical name + parent + FULL transform is the fingerprint
 * (a name can legitimately repeat at one position with a different scale, so the whole transform
 * has to be in the key). Returns a list of problems; empty means clean.
 */
function detectDoubling(pkg) {
  const problems = [];
  for (const scene of pkg.content.scenes ?? []) {
    const seen = new Map();
    for (const object of scene.objects) {
      const key = `${object.name}|${object.parentId ?? '-'}|${JSON.stringify(object.transform)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.values()].filter((count) => count > 1).length;
    if (dupes) problems.push(`scene "${scene.name}" has ${dupes} duplicated object(s)`);
  }
  const byHash = new Map();
  for (const asset of pkg.assets) {
    if (asset.hash) byHash.set(asset.hash, (byHash.get(asset.hash) ?? 0) + 1);
  }
  const repeated = [...byHash.values()].filter((count) => count > 1).length;
  if (repeated) problems.push(`${repeated} asset(s) shipped under more than one id`);
  return problems;
}

/** The catalog row for a package, whether authored here or exported from the running editor. */
function catalogEntry({ pkg, slug, file, archiveBytes, thumbnail }) {
  return {
    id: pkg.meta.id,
    slug,
    learning: TEMPLATE_LESSONS[slug],
    title: pkg.meta.name,
    description: pkg.meta.description ?? '',
    author: pkg.meta.author ?? 'Feather',
    version: pkg.meta.version,
    kind: pkg.kind,
    tags: pkg.meta.tags ?? [],
    license: slug === 'template-verdant' ? 'Custom / mixed: code MIT; terrain assets CC0-1.0; original generated audio subject to provider terms (no additional grant)' : pkg.meta.license ?? (['template-last-light', 'template-blackthorn'].includes(slug) ? 'MIT' : 'CC0-1.0'),
    priceCents: 0,
    thumbnail: thumbnail ?? pkg.meta.thumbnail,
    sizeBytes: installFootprint(archiveBytes),
    downloadUrl: `packages/${file}`,
    engineVersion: ENGINE_VERSION,
    // The store card needs the module id up front (installed/removable state, build-support check)
    // without downloading the archive first.
    ...(pkg.meta.pluginId ? { pluginId: pkg.meta.pluginId } : {}),
    contents: {
      prefabs: pkg.content.prefabs.length,
      materials: pkg.content.materials.length,
      blueprints: pkg.content.blueprints.length,
      assets: pkg.assets.length,
      scenes: pkg.content.scenes?.length ?? 0,
      uiDocuments: pkg.content.uiDocuments?.length ?? 0,
    },
  };
}

// ------------------------------------------------------------------------------------------------

async function main() {
  const published = JSON.parse(await readFile(join(ROOT, 'public/store/catalog.json'), 'utf8'));
  const captures = JSON.parse(await readFile(join(PREVIEWS_DIR, 'captures.json'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }));
  const attachPreview = async (entry, archive: Uint8Array) => {
    const capture = captures[entry.slug];
    if (!capture) return entry;
    const hash = createHash('sha256').update(archive).digest('hex');
    if (capture.packageSha256 !== hash) return { ...entry, previewStatus: 'stale' };
    const screenshots = [];
    for (const image of capture.images ?? []) {
      if (!/^[a-z0-9-]+-\d{2}\.webp$/.test(image.file)) throw new Error(`Invalid capture filename for ${entry.slug}.`);
      const bytes = await readFile(join(PREVIEWS_DIR, image.file));
      screenshots.push({ url: `data:image/webp;base64,${bytes.toString('base64')}`, alt: image.alt, width: image.width, height: image.height });
    }
    return screenshots.length ? { ...entry, thumbnail: screenshots[0].url, screenshots, previewType: 'capture', previewStatus: 'verified' } : entry;
  };
  // One folder per kind, so what a package IS is obvious from where it lives — both here and in
  // whatever bucket this is eventually mirrored into.
  for (const dir of Object.values(KIND_DIRS)) await mkdir(join(PACKAGES_DIR, dir), { recursive: true });

  const packs = [
    ARBOR_FORGE_PLUGIN,
    MODEL_FORGE_PLUGIN,
  ];
  const entries = [];
  for (const pack of packs) {
    const kind = pack.kind ?? 'asset';
    const pkg = buildPackage(pack.meta, pack.content, pack.assets ?? [], kind);
    // One file: manifest plus every asset's bytes, compressed.
    const archive = writePackageArchive(pkg, pack.assetBytes ?? new Map(), { mtime: new Date(EPOCH) });
    const file = `${KIND_DIRS[kind]}/${pack.slug}.nfpack`;
    await writeFile(join(PACKAGES_DIR, file), archive);
    entries.push(await attachPreview(catalogEntry({ pkg, slug: pack.slug, file, archiveBytes: archive.byteLength }), archive));
    console.log(`  ${file} — ${(archive.byteLength / 1024).toFixed(1)} KB`);
  }

  // Starter templates are produced by the running editor (`?exportTemplate=<key>`, written by the
  // dev-server sink in vite.config.ts) because they're imperative builders, not data. Pick up
  // whatever has been exported so far and list it.
  const projectsDir = join(PACKAGES_DIR, KIND_DIRS.project);
  // Published fixtures seed a fresh checkout. Keep any newly exported authoring files intact.
  const fixtureProjects = join(ROOT, '.feather-cache/store-fixtures/packages/projects');
  for (const file of await readdir(fixtureProjects)) {
    if (!file.endsWith('.nfpack')) continue;
    await copyFile(join(fixtureProjects, file), join(projectsDir, file), 1).catch((error) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const generated = new Set(packs.map(pack => pack.slug));
  const exported: string[] = [];
  for (const folder of Object.values(KIND_DIRS)) {
    for (const name of (await readdir(join(PACKAGES_DIR, folder))).sort()) {
      if (!/^[a-z0-9-]+\.nfpack$/.test(name)) continue;
      const slug = name.replace(/\.nfpack$/, '');
      if (!generated.has(slug) && !isRetiredStoreSlug(slug)) exported.push(`${folder}/${name}`);
    }
  }
  const doubled = [];
  for (const name of exported) {
    const file = name;
    const raw = new Uint8Array(await readFile(join(PACKAGES_DIR, file)));
    const { pkg } = readPackageFile(raw);
    const problems = detectDoubling(pkg);
    if (problems.length) doubled.push(`  ${file}: ${problems.join('; ')}`);
    const slug = name.split('/').pop()!.replace(/\.nfpack$/, '');
    if (file.split('/')[0] !== KIND_DIRS[pkg.kind]) throw new Error(`${slug}: package kind does not match its folder.`);
    if (pkg.kind !== 'project' && !pkg.meta.license) throw new Error(`${slug}: choose an explicit license with store:add before staging a custom asset or plugin.`);
    const [from, to, glyph] = TEMPLATE_THUMBNAILS[slug] ?? ['#5B8CFF', '#1B2C63', '\u{1F5FA}'];
    let cover = published.packages.find((entry) => entry.slug === slug)?.thumbnail ?? thumbnail(from, to, glyph);
    if (slug === 'template-tower-defense') {
      const preview = await readFile(join(PREVIEWS_DIR, 'sproutwatch.png')).catch(() => null);
      if (preview) cover = `data:image/png;base64,${preview.toString('base64')}`;
    }
    if (['template-last-light', 'template-blackthorn', 'template-verdant', 'template-parcel-panic', 'template-moba'].includes(slug)) {
      // A real engine capture, produced by render-cinematic.mjs (or e2e/resonance.mjs). Inline like the
      // other covers so the catalog remains portable/offline, even when served from another host.
      const preview = await readFile(join(PREVIEWS_DIR, slug === 'template-moba' ? 'moba.png' : slug === 'template-parcel-panic' ? 'parcel-panic.png' : slug === 'template-verdant' ? 'verdant.png' : slug === 'template-blackthorn' ? 'blackthorn.png' : 'last-light.png')).catch(() => null);
      if (preview) cover = `data:image/png;base64,${preview.toString('base64')}`;
    }
    entries.push(await attachPreview(catalogEntry({ pkg, slug, file, archiveBytes: raw.byteLength, thumbnail: cover }), raw));
    console.log(`  ${file} — ${(raw.byteLength / 1048576).toFixed(1)} MB single file (exported from the editor)`);
  }

  if (doubled.length) {
    console.error('\nRefusing to write the catalog — these exports look doubled:');
    console.error(doubled.join('\n'));
    console.error('\nRe-export them (`?exportTemplate=<key>`) and run this again.');
    process.exit(1);
  }

  const catalog = {
    format: CATALOG_FORMAT,
    formatVersion: '1.0.0',
    updatedAt: ISO,
    packages: entries,
  };
  await writeFile(join(OUT_DIR, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`\nStaged ${entries.length} packages + catalog.json in .feather-cache/store/. Run npm run store:publish to publish.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
