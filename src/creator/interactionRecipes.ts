import type { SimpleInteractionDraft } from './simpleInteractions';

export interface InteractionRecipe {
  id: string;
  name: string;
  description: string;
  rule: SimpleInteractionDraft;
}

/** Recipes produce ordinary editable rules and use the same compiler as the manual form. */
export const INTERACTION_RECIPES: readonly InteractionRecipe[] = [
  { id: 'door', name: 'Open a door', description: 'Interact to turn this prop 90 degrees over 0.8 seconds.', rule: { trigger: { type: 'interact' }, action: { type: 'rotate', vector: [0, 90, 0] }, duration: 0.8 } },
  { id: 'collectible', name: 'Collect a prop', description: 'Turn a plain prop into a trigger that awards 10 points and disappears.', rule: { trigger: { type: 'trigger-enter' }, action: { type: 'score', value: 10 }, then: [{ type: 'destroy' }] } },
  { id: 'hazard', name: 'Hurt on contact', description: 'Deal 10 damage to the object entering this trigger.', rule: { trigger: { type: 'trigger-enter' }, action: { type: 'damage', value: 10 } } },
  { id: 'timer', name: 'Timed signal', description: 'Fire a named event every 2 seconds. Add its matching handler in this object’s Logic.', rule: { trigger: { type: 'timer', seconds: 2 }, action: { type: 'event', eventName: 'TimerPulse' } } },
  { id: 'welcome', name: 'Game start signal', description: 'Fire a named event when Play starts; safe to add to a built-in Player.', rule: { trigger: { type: 'start' }, action: { type: 'event', eventName: 'GameReady' } } },
];
