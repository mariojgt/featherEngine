import { describe, expect, it } from 'vitest';
import { CREATOR_QUICK_STARTS, findCreatorQuickStart } from '../gameTemplates';

describe('Creator quick starts', () => {
  it('maps game concepts onto the existing project template slugs', () => {
    expect(findCreatorQuickStart('third-person')?.templateSlug).toBe('template-third-person');
    expect(findCreatorQuickStart('first-person')?.templateSlug).toBe('template-first-person');
    expect(findCreatorQuickStart('top-down-action')?.templateSlug).toBe('template-cube-realm');
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
});
