import { describe, expect, it } from 'vitest';
import { CREATOR_QUICK_STARTS, findCreatorQuickStart } from '../gameTemplates';

describe('Creator quick starts', () => {
  it('maps game concepts onto the existing project template slugs', () => {
    expect(findCreatorQuickStart('third-person')?.templateSlug).toBe('template-third-person');
    expect(findCreatorQuickStart('first-person')?.templateSlug).toBe('template-first-person');
    expect(findCreatorQuickStart('top-down-action')?.templateSlug).toBe('template-cube-realm');
  });

  it('maps Platformer to the Creator kit while keeping Blank explicit', () => {
    const platformer = findCreatorQuickStart('platformer');
    const blank = findCreatorQuickStart('blank');

    expect(platformer?.comingSoon).toBeUndefined();
    expect(platformer?.gameplayKitId).toBe('platformer-starter');
    expect(platformer?.templateSlug).toBeUndefined();
    expect(blank?.comingSoon).toBeUndefined();
    expect(blank?.templateSlug).toBeUndefined();
    expect(new Set(CREATOR_QUICK_STARTS.map((entry) => entry.id)).size).toBe(CREATOR_QUICK_STARTS.length);
  });
});
