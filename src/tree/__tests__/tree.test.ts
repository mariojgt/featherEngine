import { describe, it, expect, afterEach } from 'vitest';
import type { SceneObject } from '../../types';
import { generateTree } from '../generateTree';
import { treeSpecFromArchetype, normalizeTreeSpec, treeRng } from '../treeSpec';
import { chopTree, clearTreeChops, getTreeChopState } from '../../runtime/treeChop';

const ARCHETYPES = ['conifer', 'broadleaf', 'birch', 'willow', 'palm', 'shrub', 'snag'] as const;

function makeTreeObject(id = 'tree1', archetype: (typeof ARCHETYPES)[number] = 'broadleaf'): SceneObject {
  return {
    id,
    name: 'Test Tree',
    kind: 'empty',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    tree: { enabled: true, spec: treeSpecFromArchetype(archetype, archetype), seed: 1234 },
  } as SceneObject;
}

afterEach(() => clearTreeChops());

describe('tree generation', () => {
  it('is deterministic — the same seed rebuilds an identical mesh', () => {
    // This is the entire premise of storing spec+seed instead of geometry: saves, replays and
    // multiplayer peers all rebuild the mesh independently and must agree exactly.
    const spec = treeSpecFromArchetype('broadleaf', 'oak');
    const a = generateTree(spec, 777);
    const b = generateTree(spec, 777);
    const pa = a.bark.getAttribute('position').array;
    const pb = b.bark.getAttribute('position').array;
    expect(pa.length).toBe(pb.length);
    expect(Array.from(pa.slice(0, 60))).toEqual(Array.from(pb.slice(0, 60)));
    expect(a.triangles).toBe(b.triangles);
  });

  it('produces a different tree for a different seed', () => {
    const spec = treeSpecFromArchetype('broadleaf', 'oak');
    const a = generateTree(spec, 1);
    const b = generateTree(spec, 2);
    const pa = Array.from(a.bark.getAttribute('position').array.slice(0, 60));
    const pb = Array.from(b.bark.getAttribute('position').array.slice(0, 60));
    expect(pa).not.toEqual(pb);
  });

  it('builds every archetype with the attributes the tree material and chop system need', () => {
    for (const archetype of ARCHETYPES) {
      const generated = generateTree(treeSpecFromArchetype(archetype, archetype), 42);
      expect(generated.triangles, archetype).toBeGreaterThan(0);
      for (const geo of [generated.bark, generated.foliage]) {
        if (!geo) continue;
        expect(geo.getAttribute('aWind'), archetype).toBeTruthy();
        expect(geo.getAttribute('aTrunkT'), archetype).toBeTruthy();
        expect(geo.getAttribute('color'), archetype).toBeTruthy();
      }
      // 'snag' is the only archetype with no canopy.
      expect(Boolean(generated.foliage), archetype).toBe(archetype !== 'snag');
    }
  });

  it('packs a stylized clusters canopy into a crown volume', () => {
    const spec = treeSpecFromArchetype('broadleaf', 'oak');
    expect(spec.foliage.strategy).toBe('clusters');
    const generated = generateTree(spec, 11);
    expect(generated.foliage).toBeTruthy();
    expect(generated.triangles).toBeGreaterThan(100);
    const box = generated.bounds;
    expect(box.max.x - box.min.x).toBeGreaterThan(spec.trunk.baseRadius * 2);
    expect(box.max.y - box.min.y).toBeGreaterThan(spec.trunk.height * 0.5);
  });

  it('keeps aTrunkT inside 0..1 so the sever partition is well defined', () => {
    const generated = generateTree(treeSpecFromArchetype('conifer', 'pine'), 9);
    const t = generated.bark.getAttribute('aTrunkT');
    for (let i = 0; i < t.count; i += 1) {
      expect(t.getX(i)).toBeGreaterThanOrEqual(0);
      expect(t.getX(i)).toBeLessThanOrEqual(1);
    }
  });

  it('does not depend on Math.random — geometry is identical under a stubbed one', () => {
    // Asserting Math.random is never CALLED would test three.js, not us: it uses it for geometry uuids.
    // What actually matters is that no vertex position depends on it, so pinning it to a constant must
    // not move a single vertex.
    const spec = treeSpecFromArchetype('willow', 'w');
    const normal = generateTree(spec, 5);
    const original = Math.random;
    Math.random = () => 0.42;
    let stubbed;
    try {
      stubbed = generateTree(spec, 5);
    } finally {
      Math.random = original;
    }
    expect(Array.from(stubbed.bark.getAttribute('position').array)).toEqual(
      Array.from(normal.bark.getAttribute('position').array),
    );
  });

  it('rng produces a stable stream in 0..1', () => {
    const a = treeRng(99);
    const b = treeRng(99);
    for (let i = 0; i < 20; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('tree spec normalization', () => {
  it('clamps out-of-range values and keeps countPerLevel matched to levels', () => {
    const spec = normalizeTreeSpec({
      id: 'x',
      trunk: { height: 999, baseRadius: -5 },
      branches: { levels: 9, countPerLevel: [3] },
    } as never);
    expect(spec.trunk.height).toBeLessThanOrEqual(30);
    expect(spec.trunk.baseRadius).toBeGreaterThan(0);
    expect(spec.branches.levels).toBe(3);
    expect(spec.branches.countPerLevel).toHaveLength(3);
  });

  it('sorts break points by height so the chop resolver can trust the order', () => {
    const spec = normalizeTreeSpec({
      id: 'x',
      chop: { breakPoints: [{ height: 0.8, hits: 1 }, { height: 0.2, hits: 1 }] },
    } as never);
    expect(spec.chop.breakPoints.map((b) => b.height)).toEqual([0.2, 0.8]);
  });

  it('fills old projects with a disabled pixel look and clamps new pixel settings', () => {
    const legacy = normalizeTreeSpec({ id: 'legacy' } as never);
    expect(legacy.look.pixelArt).toEqual({ enabled: false, leafArt: 'broad', alphaCutoff: 0.45, billboard: true });

    const painted = normalizeTreeSpec({
      id: 'painted',
      look: { pixelArt: { enabled: true, leafArt: 'not-real', alphaCutoff: 9, billboard: false } },
    } as never);
    expect(painted.look.pixelArt.enabled).toBe(true);
    expect(painted.look.pixelArt.leafArt).toBe('broad');
    expect(painted.look.pixelArt.alphaCutoff).toBe(0.95);
    expect(painted.look.pixelArt.billboard).toBe(false);
  });
});

describe('tree chopping', () => {
  it('takes the spec\'s number of hits to sever, then spawns a felled log', () => {
    const tree = makeTreeObject();
    const spec = tree.tree!.spec;
    const hits = spec.chop.breakPoints[0].hits;
    const y = spec.chop.breakPoints[0].height * spec.trunk.height;

    for (let i = 0; i < hits - 1; i += 1) {
      const result = chopTree(tree, [0, y, 0], [1, 0, 0]);
      expect(result?.severed).toBe(false);
      expect(result?.hitsLeft).toBe(hits - 1 - i);
    }
    const final = chopTree(tree, [0, y, 0], [1, 0, 0]);
    expect(final?.severed).toBe(true);
    expect(final?.logs?.length).toBeGreaterThan(0);

    const bark = final!.logs![0];
    expect(bark.physics?.bodyType).toBe('dynamic');
    expect(bark.physics?.enabled).toBe(true);
    expect(bark.renderer?.fragmentKey).toBeTruthy();
    // The kick that topples it is read off variables.__impulse the frame its body first exists.
    expect(Array.isArray(bark.variables?.__impulse)).toBe(true);
    // The canopy rides along as a child so a felled tree doesn't end up with brown leaves.
    const canopy = final!.logs!.find((piece) => piece.parentId === bark.id);
    expect(canopy).toBeTruthy();
    expect(canopy!.physics).toBeUndefined();
  });

  it('ignores hits that land nowhere near a break point', () => {
    const tree = makeTreeObject('faraway');
    expect(chopTree(tree, [0, 999, 0], [1, 0, 0])).toBeNull();
    expect(getTreeChopState('faraway')).toBeUndefined();
  });

  it('refuses to chop a tree marked unchoppable', () => {
    const tree = makeTreeObject('scenery');
    tree.tree!.choppable = false;
    const spec = tree.tree!.spec;
    const y = spec.chop.breakPoints[0].height * spec.trunk.height;
    expect(chopTree(tree, [0, y, 0], [1, 0, 0])).toBeNull();
  });

  it('clears felling progress so Stop stands the forest back up', () => {
    const tree = makeTreeObject('regrow');
    const spec = tree.tree!.spec;
    const y = spec.chop.breakPoints[0].height * spec.trunk.height;
    chopTree(tree, [0, y, 0], [1, 0, 0]);
    expect(getTreeChopState('regrow')).toBeTruthy();
    clearTreeChops();
    expect(getTreeChopState('regrow')).toBeUndefined();
  });
});
