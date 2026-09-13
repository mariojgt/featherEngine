import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { applyBlastImpulse, blastFalloff, BLAST_MAX_SPEED, BLAST_MAX_SPIN } from '../blastPhysics';

let world: RAPIER.World;
beforeAll(async () => { await RAPIER.init(); });
beforeEach(() => { world = new RAPIER.World({ x: 0, y: 0, z: 0 }); });
afterEach(() => { world.free(); });

function bodyAt(x: number, mass = 1, fixed = false) {
  const body = world.createRigidBody((fixed ? RAPIER.RigidBodyDesc.fixed() : RAPIER.RigidBodyDesc.dynamic()).setTranslation(x, 0, 0));
  world.createCollider(RAPIER.ColliderDesc.ball(0.2).setMass(mass), body);
  return body;
}

describe('Stick Hero blast pressure adapted to Feather', () => {
  it('has finite pressure at the centre and smoothly reaches zero at the edge', () => {
    expect(blastFalloff(0, 10)).toBe(1);
    expect(blastFalloff(5, 10)).toBe(0.75);
    expect(blastFalloff(10, 10)).toBe(0);
    for (const [distance, radius] of [[-1, 10], [1, 0], [NaN, 10], [1, Infinity]]) {
      expect(blastFalloff(distance, radius)).toBe(0);
    }
  });

  it('adds to existing momentum, wakes sleeping props, and respects mass', () => {
    const light = bodyAt(2), heavy = bodyAt(2, 4);
    light.setLinvel({ x: 0, y: 0, z: 3 }, true);
    heavy.sleep();
    expect(applyBlastImpulse(light, [0, 0, 0], 10, 4)).toBe(true);
    expect(applyBlastImpulse(heavy, [0, 0, 0], 10, 4)).toBe(true);
    expect(light.linvel().z).toBeCloseTo(3);
    expect(light.linvel().x).toBeCloseTo(heavy.linvel().x * 4);
    expect(heavy.isSleeping()).toBe(false);
  });

  it('bounds a chain of blasts and enables CCD on fast pieces', () => {
    const body = bodyAt(1, 0.01);
    for (let i = 0; i < 100; i++) applyBlastImpulse(body, [0, 0, 0], 10, 100);
    const v = body.linvel(), w = body.angvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(BLAST_MAX_SPEED + 0.001);
    expect(Math.hypot(w.x, w.y, w.z)).toBeLessThanOrEqual(BLAST_MAX_SPIN + 0.001);
    expect(body.isCcdEnabled()).toBe(true);
  });

  it('does not brake an actor already moving faster than the blast cap', () => {
    const body = bodyAt(1);
    body.setLinvel({ x: 80, y: 0, z: 0 }, true);
    applyBlastImpulse(body, [0, 0, 0], 10, 4);
    const v = body.linvel();
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(80, 3);
  });

  it('ignores fixed, disabled, out-of-range bodies and invalid or zero-force blasts', () => {
    const fixed = bodyAt(1, 1, true), outside = bodyAt(20), disabled = bodyAt(1), normal = bodyAt(0);
    disabled.setEnabled(false);
    for (const body of [fixed, outside, disabled]) expect(applyBlastImpulse(body, [0, 0, 0], 10, 10)).toBe(false);
    expect(applyBlastImpulse(normal, [0, 0, 0], 10, 0)).toBe(false);
    expect(applyBlastImpulse(normal, [NaN, 0, 0], 10, 10)).toBe(false);
    expect(applyBlastImpulse(normal, [0, 0, 0], Infinity, 10)).toBe(false);
    expect(normal.linvel()).toEqual({ x: 0, y: 0, z: 0 });
    expect(applyBlastImpulse(normal, [0, 0, 0], 10, 10)).toBe(true);
    expect(normal.linvel().y).toBeGreaterThan(0);
  });
});
