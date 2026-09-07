import { parseTemplateLesson, type TemplateLesson } from '../creator/templateLessons';
import { normalizePackageKind, type PackageKind } from '../project/package';

/**
 * Asset-store catalog client.
 *
 * The catalog is just an index — one JSON document listing packages and where to download each
 * `.nfpack` from. Today it is served statically out of `public/store/` (built by
 * `scripts/build-store-catalog.mjs`); pointing `VITE_STORE_URL` at a hosted catalog is the whole
 * migration to a real backend, because nothing below assumes where the JSON came from.
 */

/** Where the catalog lives. Relative paths resolve against the app's base URL. */
export const STORE_BASE_URL: string = import.meta.env.VITE_STORE_URL || 'store/';

const CATALOG_FORMAT = 'feather-store-catalog';

/** How many of each entity a package installs — shown on the card so the size is legible. */
export interface StoreListingContents {
  prefabs: number;
  materials: number;
  blueprints: number;
  assets: number;
  /** Only meaningful for `kind: 'project'` listings — a template's worlds. */
  scenes: number;
  /** Captured/authored screen or world UI documents the package installs. */
  uiDocuments?: number;
}

/** One package as advertised in the catalog. The bytes live behind `downloadUrl`. */
export interface StoreListing {
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  version: string;
  /** What installing it does — see PackageKind. Drives the card badge and the install action. */
  kind: PackageKind;
  tags: string[];
  license?: string;
  learning?: TemplateLesson;
  /** 0 for the free catalog. Reserved so paid listings don't need a schema change. */
  priceCents: number;
  /** Data URL or absolute image URL for the card. */
  thumbnail?: string;
  sizeBytes: number;
  /** Absolute after `fetchCatalog` resolves it against the catalog's own location. */
  downloadUrl: string;
  engineVersion?: string;
  /** Only on `kind: 'plugin'` listings — the compiled-in plugin module installing it activates. */
  pluginId?: string;
  contents: StoreListingContents;
}

export interface StoreCatalog {
  updatedAt?: string;
  packages: StoreListing[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const str = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const num = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

/** Ensure a base URL ends in a slash so relative package paths resolve inside it, not beside it. */
const asDirectory = (url: string) => (url.endsWith('/') ? url : `${url}/`);

/**
 * Normalise one catalog entry. Remote JSON is untrusted input, so every field is coerced and a
 * listing missing the two things we can't invent — an id and a download URL — is dropped.
 */
function parseListing(raw: unknown, baseUrl: string): StoreListing | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id);
  const downloadUrl = str(raw.downloadUrl);
  if (!id || !downloadUrl) return null;

  const contents = isRecord(raw.contents) ? raw.contents : {};
  return {
    id,
    slug: str(raw.slug, id),
    title: str(raw.title, 'Untitled package'),
    description: str(raw.description),
    author: str(raw.author, 'Unknown'),
    version: str(raw.version, '1.0.0'),
    kind: normalizePackageKind(raw.kind),
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    license: typeof raw.license === 'string' ? raw.license : undefined,
    learning: parseTemplateLesson(raw.learning),
    priceCents: num(raw.priceCents),
    thumbnail: typeof raw.thumbnail === 'string' ? raw.thumbnail : undefined,
    sizeBytes: num(raw.sizeBytes),
    // Resolved here so callers only ever handle absolute URLs — the store can move hosts freely.
    downloadUrl: new URL(downloadUrl, baseUrl).toString(),
    engineVersion: typeof raw.engineVersion === 'string' ? raw.engineVersion : undefined,
    pluginId: typeof raw.pluginId === 'string' ? raw.pluginId : undefined,
    contents: {
      prefabs: num(contents.prefabs),
      materials: num(contents.materials),
      blueprints: num(contents.blueprints),
      assets: num(contents.assets),
      scenes: num(contents.scenes),
      // Must be listed explicitly: this parser rebuilds `contents` field by field, so anything
      // not named here is silently dropped and a UI-kit package renders as "Empty package".
      uiDocuments: num(contents.uiDocuments),
    },
  };
}

/** Download and validate the catalog index. Throws a user-readable message on any failure. */
export async function fetchCatalog(baseUrl: string = STORE_BASE_URL, signal?: AbortSignal): Promise<StoreCatalog> {
  const base = new URL(asDirectory(baseUrl), document.baseURI).toString();

  let response: Response;
  try {
    response = await fetch(new URL('catalog.json', base).toString(), { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('Could not reach the asset store. Check your connection.');
  }
  if (!response.ok) throw new Error(`The asset store is unavailable (HTTP ${response.status}).`);

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new Error('The asset store returned a malformed catalog.');
  }
  if (!isRecord(raw) || raw.format !== CATALOG_FORMAT) {
    throw new Error('That URL is not a Feather asset-store catalog.');
  }

  const packages = Array.isArray(raw.packages)
    ? raw.packages.map((entry) => parseListing(entry, base)).filter((entry): entry is StoreListing => !!entry)
    : [];

  return { updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined, packages };
}

/** Every tag across the catalog, sorted, for the filter row. */
export const collectTags = (packages: StoreListing[]): string[] =>
  [...new Set(packages.flatMap((entry) => entry.tags))].sort();

/** Case-insensitive match across the fields a user would actually type. */
export function matchesQuery(listing: StoreListing, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    listing.title.toLowerCase().includes(needle) ||
    listing.description.toLowerCase().includes(needle) ||
    listing.author.toLowerCase().includes(needle) ||
    listing.tags.some((tag) => tag.toLowerCase().includes(needle))
  );
}

export function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
