/** Store packages that must stay hidden even if an older hosted catalog or export is present. */
export const RETIRED_STORE_SLUGS = [
  'template-meadows',
  'template-neon-afterlight',
  'template-cube-realm',
  'template-cinematic',
  'sunlit-reach',
  'ember-meadow',
  'titan-backend',
  'pixel-art-trees',
  'sandbox-world',
  'blade-prop',
] as const;

const retiredStoreSlugs = new Set<string>(RETIRED_STORE_SLUGS);

export const isRetiredStoreSlug = (slug: unknown): boolean =>
  typeof slug === 'string' && retiredStoreSlugs.has(slug);
