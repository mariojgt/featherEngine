import { describe, expect, it } from 'vitest';
import { CREATOR_QUICK_STARTS, findCreatorQuickStart } from '../gameTemplates';
import { parseTemplateLesson, TEMPLATE_LESSONS } from '../templateLessons';

describe('Creator quick starts', () => {
  it('offers Lumen Lane offline with a matching editable-game lesson', () => {
    const starter = findCreatorQuickStart('moba');
    expect(starter?.builtInTemplate).toBe('moba');
    expect(starter?.templateSlug).toBe('template-moba');
    const lesson = parseTemplateLesson(TEMPLATE_LESSONS[starter!.templateSlug!]);
    expect(lesson?.difficulty).toBe('Beginner');
    expect(lesson?.goal).toContain('three lanes');
    expect(lesson?.controls).toContain('Right-click');
  });

  it('offers Parcel Panic as a built-in starter with a matching store lesson', () => {
    const starter = findCreatorQuickStart('parcel-panic');
    expect(starter?.builtInTemplate).toBe('parcel-panic');
    expect(starter?.templateSlug).toBe('template-parcel-panic');
    expect(starter?.comingSoon).toBeUndefined();
    expect(starter?.gameplayKitId).toBeUndefined();
    const lesson = parseTemplateLesson(TEMPLATE_LESSONS[starter!.templateSlug!]);
    expect(lesson?.difficulty).toBe('Beginner');
    expect(lesson?.goal).toContain('five parcels');
    expect(lesson?.lessons.length).toBeGreaterThan(0);
  });

  it('offers the complete tower-defense starter offline', () => {
    expect(findCreatorQuickStart('tower-defense')).toMatchObject({
      templateSlug: 'template-tower-defense', builtInTemplate: 'tower-defense',
    });
    expect(findCreatorQuickStart('tower-defense')?.comingSoon).toBeUndefined();
  });
  it('maps game concepts onto the existing project template slugs', () => {
    expect(findCreatorQuickStart('third-person')?.templateSlug).toBe('template-third-person');
    expect(findCreatorQuickStart('first-person')?.templateSlug).toBe('template-first-person');
  });

  it('maps Platformer to its full starter world while keeping Blank explicit', () => {
    const platformer = findCreatorQuickStart('platformer');
    const blank = findCreatorQuickStart('blank');

    expect(platformer?.comingSoon).toBeUndefined();
    expect(platformer?.gameplayKitId).toBeUndefined();
    expect(platformer?.templateSlug).toBe('template-platformer');
    expect(blank?.comingSoon).toBeUndefined();
    expect(blank?.templateSlug).toBeUndefined();
    expect(new Set(CREATOR_QUICK_STARTS.map((entry) => entry.id)).size).toBe(CREATOR_QUICK_STARTS.length);
  });

  it('offers Cube RPG as a separate, offline built-in starter', () => {
    expect(findCreatorQuickStart('cube-rpg')).toMatchObject({
      label: 'Cube RPG', templateSlug: 'template-cube-rpg', builtInTemplate: 'cube-rpg',
    });
  });
});
