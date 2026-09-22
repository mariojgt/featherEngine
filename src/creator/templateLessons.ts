export interface TemplateLesson {
  version: 1;
  difficulty: 'Beginner' | 'Intermediate';
  minutes: number;
  goal: string;
  controls: string;
  lessons: readonly string[];
}

/** Shared by the launcher, catalog builder, and learning documentation. */
export const TEMPLATE_LESSONS: Readonly<Record<string, TemplateLesson>> = {
  'ember-meadow': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Log in, restore the meadow beacon, earn a blade, and reconnect with your saved progress.',
    controls: 'WASD / arrows move · right-drag orbits · E talk/gather · Space or 1 attack · 2 ability · 3 tonic · I inventory',
    lessons: ['Press Play and choose Solo practice to explore immediately.', 'Speak to Elara, gather three shards, defeat two wisps and return for your reward.', 'Open View → Extensions → Titan Backend, choose your accounts in Connect, then press Play the game → Join realm; Feather starts the local realm for you.', 'Join the realm from two browser profiles. Save, leave and reconnect.', 'Edit the scenery in Feather. Extend authoritative rules in server/world.mjs and the HUD in src/titan.'],
  },
  'sunlit-reach': {
    version: 1, difficulty: 'Intermediate', minutes: 30,
    goal: 'Pick a class, finish three chapters across Ember Meadow, Thornwood and Cinder Keep, and bring down the Ashen Warden with friends.',
    controls: 'WASD move · right-drag orbits · wheel zooms · Space/1 attack · 2 ability · 3 tonic · E talk/gather/travel · I inventory · L quest log · Enter chat',
    lessons: [
      'Press Play and choose Warrior, Ranger or Mage at the login screen — each has its own health, reach and special ability on 2.',
      'Take Warden Elara’s quest in the meadow, then follow the trail north past the woodland to the waystone and press E to travel.',
      'Reach level 2, find Hermit Wren in the Thornwood, and gather moonpetals while the boars are busy with someone else.',
      'In Cinder Keep the Ashen Warden telegraphs an ember burst — step out of the red ring. Open a second browser profile for another adventurer before you pull it.',
      'Open View → Extensions → Titan Backend and walk Connect → Test → Publish to put your own accounts and hosted realm behind the game.',
      'Every zone is a normal Feather scene: edit its scenery freely, and change the shared rules — quests, loot, the boss — in examples/titan-mmo/server/world.mjs.',
    ],
  },
  'template-cinematic': {
    version: 1, difficulty: 'Beginner', minutes: 10,
    goal: 'Watch Resonance, then remix its cameras, lighting and real physics cues.',
    controls: 'Play watches the film · Replay film or R starts again · Stop returns to editing',
    lessons: ['Open Cinematic and select one of eight named camera shots.', 'Change the global wind to move all four cloth banners.', 'Tune the reactor material or Lux lighting in the scene.', 'Open Physics & replay cues to change the impulse or fracture timing; Play from the start to simulate it.'],
  },
  'template-platformer': {
    version: 1, difficulty: 'Beginner', minutes: 10,
    goal: 'Collect sun seeds and reach Sunny at the end of the cloud course.',
    controls: 'WASD move · Space jump · Shift dash · Left click bop · P pause',
    lessons: ['Change a Sun Seed color in Appearance.', 'Tune collectible points in Gameplay.', 'Add a timed rule to a plain prop.', 'Play, save, and export your own cloud course.'],
  },
  'template-third-person': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Explore a small tutorial world with a controllable character and follow camera.',
    controls: 'WASD move · Space jump · Shift sprint · Mouse look',
    lessons: ['Select the Player and try a movement preset.', 'Change a prop into a Door using Make It.', 'Import a model and replace a prop appearance.', 'Test your changes in Play, then export.'],
  },
  'template-first-person': {
    version: 1, difficulty: 'Intermediate', minutes: 20,
    goal: 'Remix an FPS arena with weapons, targets, and a working HUD.',
    controls: 'Read the in-game controls for movement and weapon bindings.',
    lessons: ['Inspect the Player and weapon objects.', 'Tune a target in Gameplay.', 'Change the HUD in the UI editor.', 'Check input and assets in your exported build.'],
  },
  'template-cube-realm': {
    version: 1, difficulty: 'Intermediate', minutes: 20,
    goal: 'Explore and modify the action starter with enemies and objectives.',
    controls: 'Read the in-game controls before starting the encounter.',
    lessons: ['Find the Player and objective objects.', 'Inspect enemy behavior in Logic.', 'Replace scenery while keeping collision roots.', 'Play through the objective and export.'],
  },
};

export function parseTemplateLesson(raw: unknown): TemplateLesson | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<TemplateLesson>;
  if (value.version !== 1 || !['Beginner', 'Intermediate'].includes(value.difficulty ?? '') || !Number.isFinite(value.minutes) || Number(value.minutes) <= 0 || typeof value.goal !== 'string' || typeof value.controls !== 'string' || !Array.isArray(value.lessons) || !value.lessons.every((item) => typeof item === 'string')) return undefined;
  return { version: 1, difficulty: value.difficulty!, minutes: value.minutes!, goal: value.goal, controls: value.controls, lessons: value.lessons };
}
