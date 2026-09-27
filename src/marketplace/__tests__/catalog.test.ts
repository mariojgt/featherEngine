import { describe, it, expect, afterEach, vi } from 'vitest';
import { collectTags, fetchCatalog, formatSize, matchesQuery, type StoreListing } from '../catalog';
import { RETIRED_STORE_SLUGS } from '../retiredPackages';

/** Catalog JSON is untrusted remote input — these cover coercion, rejection and URL resolution. */

const CATALOG = {
  format: 'feather-store-catalog',
  formatVersion: '1.0.0',
  updatedAt: '2026-01-01T00:00:00.000Z',
  packages: [
    {
      id: 'pkg-a',
      slug: 'props',
      title: 'Prop Pack',
      description: 'Crates and barrels',
      author: 'Feather',
      version: '1.0.0',
      kind: 'asset',
      tags: ['props', 'physics'],
      priceCents: 0,
      sizeBytes: 2048,
      downloadUrl: 'packages/props.nfpack',
      contents: { prefabs: 3, materials: 2, blueprints: 0, assets: 0 },
    },
  ],
};

const stubFetch = (response: { ok?: boolean; status?: number; json: () => Promise<unknown> }) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, ...response }));

const listing = (overrides: Partial<StoreListing> = {}): StoreListing => ({
  id: 'x',
  slug: 'x',
  title: 'Neon Signage Kit',
  description: 'Emissive pillars for city scenes',
  author: 'Feather',
  version: '1.0.0',
  kind: 'asset',
  tags: ['lighting', 'cyberpunk'],
  priceCents: 0,
  sizeBytes: 1024,
  downloadUrl: 'https://example.com/x.nfpack',
  contents: { prefabs: 1, materials: 1, blueprints: 0, assets: 0, scenes: 0 },
  ...overrides,
});

describe('fetchCatalog', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves relative package URLs against the catalog location', async () => {
    stubFetch({ json: async () => CATALOG });
    const catalog = await fetchCatalog('store/');
    expect(catalog.packages).toHaveLength(1);
    // The panel only ever sees absolute URLs, so the store can be rehosted without touching callers.
    expect(catalog.packages[0].downloadUrl).toBe(`${new URL('store/packages/props.nfpack', document.baseURI)}`);
  });

  it('resolves against an absolute base, so a hosted catalog works unchanged', async () => {
    stubFetch({ json: async () => CATALOG });
    const catalog = await fetchCatalog('https://cdn.example.com/feather-store/');
    expect(catalog.packages[0].downloadUrl).toBe('https://cdn.example.com/feather-store/packages/props.nfpack');
  });

  it('rejects JSON that is not a store catalog', async () => {
    stubFetch({ json: async () => ({ hello: 'world' }) });
    await expect(fetchCatalog('store/')).rejects.toThrow('not a Feather asset-store catalog');
  });

  it('reports an HTTP failure readably', async () => {
    stubFetch({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchCatalog('store/')).rejects.toThrow('HTTP 503');
  });

  it('drops entries that lack an id or a download URL rather than failing the whole catalog', async () => {
    stubFetch({
      json: async () => ({
        ...CATALOG,
        packages: [...CATALOG.packages, { id: 'broken' }, { downloadUrl: 'x.nfpack' }],
      }),
    });
    const catalog = await fetchCatalog('store/');
    expect(catalog.packages.map((entry) => entry.id)).toEqual(['pkg-a']);
  });

  it('hides retired packages from stale hosted catalogs', async () => {
    stubFetch({
      json: async () => ({
        ...CATALOG,
        packages: [
          ...CATALOG.packages,
          ...RETIRED_STORE_SLUGS.map((slug) => ({ ...CATALOG.packages[0], id: `retired-${slug}`, slug })),
        ],
      }),
    });
    const catalog = await fetchCatalog('store/');
    expect(catalog.packages.map((entry) => entry.slug)).toEqual(['props']);
  });

  it('coerces missing optional fields instead of trusting the payload', async () => {
    stubFetch({
      json: async () => ({
        ...CATALOG,
        packages: [{ id: 'sparse', downloadUrl: 'sparse.nfpack' }],
      }),
    });
    const [entry] = (await fetchCatalog('store/')).packages;
    expect(entry).toMatchObject({
      title: 'Untitled package',
      author: 'Unknown',
      kind: 'asset',
      tags: [],
      priceCents: 0,
      contents: { prefabs: 0, materials: 0, blueprints: 0, assets: 0, scenes: 0 },
    });
  });
});

describe('browse helpers', () => {
  it('matches on title, description, author and tags', () => {
    const entry = listing();
    expect(matchesQuery(entry, '')).toBe(true);
    expect(matchesQuery(entry, 'neon')).toBe(true);
    expect(matchesQuery(entry, 'EMISSIVE')).toBe(true);
    expect(matchesQuery(entry, 'feather')).toBe(true);
    expect(matchesQuery(entry, 'cyberpunk')).toBe(true);
    expect(matchesQuery(entry, 'racing')).toBe(false);
  });

  it('collects a sorted, de-duplicated tag list', () => {
    expect(collectTags([listing(), listing({ tags: ['props', 'lighting'] })])).toEqual([
      'cyberpunk',
      'lighting',
      'props',
    ]);
  });

  it('formats sizes for the card footer', () => {
    expect(formatSize(0)).toBe('—');
    expect(formatSize(512)).toBe('512 B');
    expect(formatSize(2048)).toBe('2.0 KB');
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
