import type { VehicleComponent } from '../types';

/** A wheel with every role made explicit — what the physics, VFX and Inspector all consume. */
export interface ResolvedVehicleWheel {
  objectId: string;
  axle: 'front' | 'rear';
  side: 'left' | 'right';
  steered: boolean;
}

/**
 * Resolve a vehicle's wheel rig into explicit per-wheel roles.
 *
 * Prefers the modern `wheels` list (Unreal-style explicit references — nothing depends on order).
 * Falls back to the LEGACY positional convention for older cars: `wheelObjectIds` in
 * [FL, FR, RL, RR] order (first half = front, even index = left) + `steeredWheelIds`. Legacy
 * steering may also be declared via a wheel's ANCHOR parent id — the physics layer ORs that in
 * (it needs the scene to resolve parents), so legacy `steered` here is only the direct-id match.
 */
export function resolveVehicleWheels(v: VehicleComponent): ResolvedVehicleWheel[] {
  if (v.wheels?.length) {
    return v.wheels.map((w) => ({
      objectId: w.objectId,
      axle: w.axle,
      side: w.side,
      steered: w.steered ?? w.axle === 'front',
    }));
  }
  const ids = v.wheelObjectIds ?? [];
  const steeredSet = new Set(v.steeredWheelIds ?? []);
  const half = Math.max(1, ids.length / 2);
  return ids.map((objectId, i) => ({
    objectId,
    axle: i < half ? 'front' : 'rear',
    side: i % 2 === 0 ? 'left' : 'right',
    steered: steeredSet.has(objectId),
  }));
}
