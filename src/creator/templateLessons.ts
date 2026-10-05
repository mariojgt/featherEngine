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
  'template-cinderfall': {
    version: 1, difficulty: 'Intermediate', minutes: 20,
    goal: 'Mine sixteen aetherite units, survive the cave and extract before the rig departs.',
    controls: 'WASD move · Shift sprint · LMB fire · R reload · Hold E mine/extract · F headlamp · P pause',
    lessons: ['Explore the five veins; four fill the quota.', 'Reload between fights and follow the amber survey lights back to the rig.', 'Edit the original rifle and cave assets in Model Forge.', 'Open the six gameplay Blueprints in Logic and inspect their FeatherScript.', 'Test replay and a web export; use a build with Model Forge camera view-model support.'],
  },
  'template-cube-rpg': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Conquer three sky arenas with Cubie, then remix your own action RPG.',
    controls: 'WASD move · Space jump · Shift sprint · click / J ×3 combo · jump + click ground slam · hold Q / right click block · 1 / 2 equip · E / 3 potion · P pause',
    lessons: [
      'Choose Cube RPG in the launcher, press Play, then Begin adventure. This starter is included offline.',
      'Tap attack three times for slash, backhand and a spinning finisher; jump and attack to plunge into a ground slam.',
      'Pink sparks mean a grumble is committed: light slashes will not stop it. Block, step away, or break it with the finisher or slam; potions restore 45 health.',
      'Clear an arena and follow the golden arch. Each new arena raises your level and grants two potions.',
      'Select Cubie · Playable Cube Knight in Characters to edit the reusable cube, eyes, helmet, sword or shield.',
      'Edit Grumble · Chase, Telegraph & Loot and opponent instance variables to change health, damage, speed or arena.',
      'Select named objects in Editable VFX to change colors, size, lifetime and particle count. Edit the Adventure HUD for your own menus.',
      'Edit Cubie · Walk, Strike & Expressions or Grumble · Motion & Hit Reactions for poses and timing. Combat · Per-Character Damage Flash and Combat · Impact Star control contact effects; CubeImpact in Cubie combat controls the camera kick.',
    ],
  },
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
  'template-tower-defense': {
    version: 1, difficulty: 'Beginner', minutes: 15,
    goal: 'Protect a mushroom garden from ten waves of cartoon zombies.',
    controls: 'Click a defender and a numbered pad · 1/2/3 select · Space sends a wave · P pauses',
    lessons: ['Build near bends so defenders cover more of the path.', 'Mix rapid Pea Sprouts, slowing Snowdrops and splash-damage Pumpkin Mortars.', 'Click a planted defender to upgrade or sell between waves.', 'Edit the garden scenery and shared materials. The built-in game rules live in src/towerDefense/game.ts.', 'Each new Tower Defense project gets a generated layout; use create_tower_defense_template with a seed for reproducible maps. Save and export to play outside the editor.'],
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
