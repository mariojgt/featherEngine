import type { RigidBody } from '@dimforge/rapier3d-compat';
import type { Vector3Tuple } from '../types';

// Adapted from stick-hero/src/physics/blast.ts: smooth pressure, preserved momentum,
// bounded chain reactions, and CCD for fast debris. Feather keeps force in impulse units.
export const BLAST_MAX_SPEED = 36;
export const BLAST_MAX_SPIN = 9;
export const BLAST_CCD_SPEED = 10;

export function blastFalloff(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius) || radius <= 0 || distance < 0) return 0;
  const t = Math.min(1, distance / radius);
  return 1 - t * t;
}

function limit(vector: { x: number; y: number; z: number }, maximum: number): void {
  const speed = Math.hypot(vector.x, vector.y, vector.z);
  if (speed > maximum) {
    const factor = maximum / speed;
    vector.x *= factor; vector.y *= factor; vector.z *= factor;
  }
}

/** Adds a blast to dynamic bodies only; an already fast actor is never slowed to the debris cap. */
export function applyBlastImpulse(body: RigidBody, center: Vector3Tuple, radius: number, strength: number, up = 0.4): boolean {
  if (!body.isEnabled() || !body.isDynamic() || ![...center, radius, strength, up].every(Number.isFinite)
    || radius <= 0 || strength <= 0) return false;
  const p = body.translation();
  const dx = p.x - center[0], dy = p.y - center[1], dz = p.z - center[2];
  const distance = Math.hypot(dx, dy, dz);
  const falloff = blastFalloff(distance, radius);
  if (!falloff) return false;
  const before = body.linvel(), turn = body.angvel();
  const speedLimit = Math.max(BLAST_MAX_SPEED, Math.hypot(before.x, before.y, before.z));
  const spinLimit = Math.max(BLAST_MAX_SPIN, Math.hypot(turn.x, turn.y, turn.z));
  const k = Math.min(strength, 1e6) * falloff;
  const inv = 1 / Math.max(0.001, distance);
  body.applyImpulse({ x: dx * inv * k, y: (Math.max(-0.35, dy * inv) + up) * k, z: dz * inv * k }, true);
  // Spin follows the pressure direction, so repeated breaks are reproducible.
  body.applyTorqueImpulse({ x: dz * inv * k * 0.18, y: k * 0.063, z: -dx * inv * k * 0.18 }, true);
  const velocity = body.linvel(), spin = body.angvel();
  limit(velocity, speedLimit); limit(spin, spinLimit);
  body.setLinvel(velocity, true); body.setAngvel(spin, true);
  if (Math.hypot(velocity.x, velocity.y, velocity.z) >= BLAST_CCD_SPEED) body.enableCcd(true);
  return true;
}
