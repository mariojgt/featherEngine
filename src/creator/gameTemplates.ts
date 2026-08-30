export const CREATOR_QUICK_START_IDS = [
  'third-person',
  'first-person',
  'top-down-action',
  'platformer',
  'blank',
] as const;

export type CreatorQuickStartId = (typeof CREATOR_QUICK_START_IDS)[number];

export interface CreatorQuickStart {
  id: CreatorQuickStartId;
  label: string;
  description: string;
  icon: string;
  templateSlug?: string;
  gameplayKitId?: import('./gameplayKits').CreatorGameplayKitId;
  comingSoon?: boolean;
}

/** Friendly game choices mapped onto Feather's existing project packages. */
export const CREATOR_QUICK_STARTS: readonly CreatorQuickStart[] = [
  {
    id: 'third-person',
    label: 'Third Person',
    description: 'Character, follow camera, combat and a playable tutorial world.',
    icon: '🎮',
    templateSlug: 'template-third-person',
  },
  {
    id: 'first-person',
    label: 'First Person',
    description: 'FPS controls, weapons, enemies and interactive props.',
    icon: '🎯',
    templateSlug: 'template-first-person',
  },
  {
    id: 'top-down-action',
    label: 'Top Down',
    description: 'An editable action starter with combos, a day cycle and objectives.',
    icon: '🗺️',
    templateSlug: 'template-cube-realm',
  },
  {
    id: 'platformer',
    label: 'Platformer',
    description: 'A playable character, moving platforms, collectibles and score HUD.',
    icon: '🏃',
    gameplayKitId: 'platformer-starter',
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
