export const CREATOR_GAMEPLAY_KIT_IDS = [
  'third-person-starter',
  'collectible-game',
  'combat-starter',
  'platformer-starter',
  'interaction-starter',
] as const;

export type CreatorGameplayKitId = (typeof CREATOR_GAMEPLAY_KIT_IDS)[number];

export interface CreatorGameplayKit {
  id: CreatorGameplayKitId;
  name: string;
  description: string;
  icon: string;
}

export const CREATOR_GAMEPLAY_KITS: CreatorGameplayKit[] = [
  { id: 'third-person-starter', name: 'Third Person Starter', description: 'Ground and a playable third-person character.', icon: '🎮' },
  { id: 'collectible-game', name: 'Collectible Game', description: 'Player, score HUD, and five working collectibles.', icon: '💰' },
  { id: 'combat-starter', name: 'Combat Starter', description: 'Player, three chasing enemies, and a destructible prop.', icon: '⚔️' },
  { id: 'platformer-starter', name: 'Platformer Starter', description: 'Player, moving platforms, collectibles, and score HUD.', icon: '🧱' },
  { id: 'interaction-starter', name: 'Interaction Starter', description: 'Player and an immediately usable interactive door.', icon: '🚪' },
];

export const findCreatorGameplayKit = (id: string): CreatorGameplayKit | undefined =>
  CREATOR_GAMEPLAY_KITS.find((kit) => kit.id === id);
