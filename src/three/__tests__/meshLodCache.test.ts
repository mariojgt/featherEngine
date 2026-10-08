import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { BufferAttribute, BufferGeometry, SphereGeometry } from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { getLodGeometry, isLodCandidate, meshLodReady, setLodGenBudget } from '../meshLodCache';

describe('automatic mesh reduction', () => {
  const sources: BufferGeometry[] = [];
  const sphere = () => {
    const source = new SphereGeometry(0.55, 32, 24);
    sources.push(source);
    return source;
  };
  beforeAll(async () => { await MeshoptSimplifier.ready; });
  afterEach(() => { sources.splice(0).forEach((geometry) => geometry.dispose()); setLodGenBudget(0); });

  it('reduces real meshes at both levels even when the raw target is not a complete triangle', () => {
    const source = sphere();
    expect(meshLodReady()).toBe(true);
    expect(isLodCandidate(source)).toBe(true);
    expect(Math.floor(source.index!.count * 0.4) % 3).not.toBe(0);
    setLodGenBudget(2);
    const level1 = getLodGeometry(source, 1)!;
    const level2 = getLodGeometry(source, 2)!;
    expect(level1).not.toBe(source);
    expect(level1.index!.count).toBeLessThanOrEqual(source.index!.count * 0.4);
    expect(level2.index!.count).toBeLessThanOrEqual(source.index!.count * 0.15);
    expect(level1.getAttribute('position')).toBe(source.getAttribute('position'));
    expect(level2.getAttribute('normal')).toBe(source.getAttribute('normal'));
    expect(getLodGeometry(source, 1)).toBe(level1);
    expect(getLodGeometry(source, 0)).toBe(source);
  });

  it('honors the generation budget and releases generated levels with their source', () => {
    const source = sphere();
    setLodGenBudget(0);
    expect(getLodGeometry(source, 1)).toBeNull();
    setLodGenBudget(1);
    const level1 = getLodGeometry(source, 1)!;
    expect(getLodGeometry(source, 2)).toBe(level1);
    let disposed = false;
    level1.addEventListener('dispose', () => { disposed = true; });
    source.dispose();
    expect(disposed).toBe(true);
  });

  it('uses the actual vertex stride for four-component position attributes', () => {
    const source = sphere();
    const positions = source.getAttribute('position');
    const values = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
      values.set([positions.getX(i), positions.getY(i), positions.getZ(i), 1], i * 4);
    }
    source.setAttribute('position', new BufferAttribute(values, 4));
    setLodGenBudget(1);
    const level1 = getLodGeometry(source, 1)!;
    expect(level1).not.toBe(source);
    expect(level1.index!.count).toBeLessThan(source.index!.count);
    expect(level1.getAttribute('position')).toBe(source.getAttribute('position'));
  });

  it('leaves authored partial draw ranges and material groups intact', () => {
    const source = sphere();
    source.setDrawRange(3, source.index!.count - 3);
    expect(isLodCandidate(source)).toBe(false);
    source.setDrawRange(0, Infinity);
    source.addGroup(3, source.index!.count - 3);
    expect(isLodCandidate(source)).toBe(false);
    source.clearGroups();
    source.addGroup(0, source.index!.count, 3);
    expect(isLodCandidate(source)).toBe(true);
    setLodGenBudget(1);
    const reduced = getLodGeometry(source, 1)!;
    expect(reduced.groups).toEqual([{ start: 0, count: reduced.index!.count, materialIndex: 3 }]);
  });
});
