/** Launcher curation only; package archives, builders and explicit creation APIs stay available. */
const HIDDEN_LAUNCHER_STARTER_SLUGS: ReadonlySet<string> = new Set([
  'template-third-person',
  'template-sim-racing',
  'template-tower-defense',
]);

export const isLauncherStarterVisible = (slug: string): boolean =>
  !HIDDEN_LAUNCHER_STARTER_SLUGS.has(slug);

/** Stable identifiers, including optional starters that are no longer launcher choices. */
export const CREATOR_QUICK_START_IDS = [
  'third-person',
  'first-person',
  'platformer',
  'parcel-panic',
  'moba',
  'tower-defense',
  'crystal-slice',
  'blank',
] as const;

export type CreatorQuickStartId = (typeof CREATOR_QUICK_START_IDS)[number];
export type BuiltInTemplate = 'platformer' | 'parcel-panic' | 'moba' | 'tower-defense' | 'crystal-slice' | 'cinderfall';

export interface CreatorQuickStart {
  id: CreatorQuickStartId;
  label: string;
  description: string;
  icon: string;
  templateSlug?: string;
  builtInTemplate?: BuiltInTemplate;
  projectTitle?: string;
  gameplayKitId?: import('./gameplayKits').CreatorGameplayKitId;
  comingSoon?: boolean;
}

/** Default launcher choices mapped onto Feather's existing project packages. */
export const CREATOR_QUICK_STARTS: readonly CreatorQuickStart[] = [
  {
    id: 'first-person',
    label: 'First Person',
    description: 'FPS controls, weapons, enemies and interactive props.',
    icon: '🎯',
    templateSlug: 'template-first-person',
  },
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'A stylized sky course with an animated cartoon hero, moving clouds, collectibles and a polished HUD.',
    icon: '🏃',
    templateSlug: 'template-platformer',
    builtInTemplate: 'platformer',
    projectTitle: 'Cloudstep Garden',
  },
  {
    id: 'parcel-panic',
    label: 'Parcel Panic',
    description: 'A cheerful robot delivery game with animated movement, tumbling parcels and playful physics. Deliver five parcels, then explore a new village.',
    icon: '📦',
    templateSlug: 'template-parcel-panic',
    builtInTemplate: 'parcel-panic',
  },
  {
    id: 'moba',
    label: 'Lumen Lane',
    description: 'Five champions, three lanes, point-and-click combat, a forest battlefield and an item shop. Lead your AI allies and shatter the enemy core.',
    icon: '⚔️',
    templateSlug: 'template-moba',
    builtInTemplate: 'moba',
    projectTitle: 'Lumen Lane',
  },
  {
    id: 'crystal-slice',
    label: 'Crystal Slice',
    description: 'A chrome blade cuts an intact crystal block into colliding pieces that tumble into a reflective pool.',
    icon: '💎',
    builtInTemplate: 'crystal-slice',
  },
  {
    id: 'blank',
    label: 'Blank',
    description: 'Start with Feather\'s beautiful default scene and build freely.',
    icon: '✨',
  },
];

export const findCreatorQuickStart = (id: CreatorQuickStartId) =>
  CREATOR_QUICK_STARTS.find((entry) => entry.id === id);
