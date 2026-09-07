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
