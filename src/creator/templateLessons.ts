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
  'template-verdant': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Watch a woodland film, then make your own landscape cinematic.',
    controls: 'Play watches the 48-second film · R restarts it · Stop returns to editing',
    lessons: [
      'Open Cinematic and select Verdant · A Woodland Study; edit any of the six named camera shots.',
      'Select Woodland in the scene and adjust trees, grass and understorey in Foliage.',
      'Change the sun angle, wind or fog in the scene environment.',
      'Replace the opening sound cue with your own audio; the two non-autoplay stem sequences are available for audition.',
      'Save a project package to share the editable scene. Check the audio provider terms before redistributing generated stems.',
    ],
  },
  'template-platformer': {
    version: 1, difficulty: 'Beginner', minutes: 10,
    goal: 'Collect sun seeds and reach Sunny at the end of the cloud course.',
    controls: 'WASD move · Space jump · Shift dash · Left click bop · P pause',
    lessons: ['Change a Sun Seed color in Appearance.', 'Tune collectible points in Gameplay.', 'Add a timed rule to a plain prop.', 'Play, save, and export your own cloud course.'],
  },
  'template-moba': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Choose a champion, push one of three lanes with your allies and destroy the enemy core.',
    controls: 'Right-click move/attack · Q ability · E dash · R ultimate · B recall · S stop · P shop · Esc pause',
    lessons: [
      'Choose from five champions, click to move and attack, and travel using the minimap.',
      'Break any enemy lane tower to expose its core. Earn gold from combat and buy items at base with P.',
      'Stop Play and recolour the arena or inspect the hero and minion prefabs.',
      'Open the game blueprints to tune health, damage, cooldowns and wave timing.',
      'Change the HUD in the UI editor, then save, reopen and export your game.',
    ],
  },
  'template-parcel-panic': {
    version: 1, difficulty: 'Beginner', minutes: 10,
    goal: 'Help a robot courier deliver five parcels to the matching baskets on a sunny island.',
    controls: 'WASD move · Space jump · Shift hurry · E pick up · Q throw · R recall · P pause · Enter skip opening',
    lessons: [
      'Deliver five parcels in relaxed play, then use Pause to try the 90-second rush.',
      'Choose New village for a different layout, or Retry to practise the same village code.',
      'Stop and change a scenery material in Appearance; keep parcel and basket colours recognisable.',
      'Inspect courier limb animation, seeded Village blueprints and parcel mass; reuse the eleven editable prefabs.',
      'Save, reopen and test your changes, then export a web build.',
    ],
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
};

export function parseTemplateLesson(raw: unknown): TemplateLesson | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const value = raw as Partial<TemplateLesson>;
  if (value.version !== 1 || !['Beginner', 'Intermediate'].includes(value.difficulty ?? '') || !Number.isFinite(value.minutes) || Number(value.minutes) <= 0 || typeof value.goal !== 'string' || typeof value.controls !== 'string' || !Array.isArray(value.lessons) || !value.lessons.every((item) => typeof item === 'string')) return undefined;
  return { version: 1, difficulty: value.difficulty!, minutes: value.minutes!, goal: value.goal, controls: value.controls, lessons: value.lessons };
}
