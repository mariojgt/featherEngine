import type { Vector3Tuple } from '../types';

const MODULUS = 2147483647;
export const PARCEL_VILLAGE_DEFAULT_SEED = 27183;
export function normalizeVillageSeed(seed: number): number {
  return Number.isFinite(seed) ? Math.max(1, Math.floor(Math.abs(seed)) % 999983) : PARCEL_VILLAGE_DEFAULT_SEED;
}

/** A keyed integer hash: independent draws keep changing one prop from moving the whole village. */
export function villageSample(seed: number, key: number): number {
  let value = (seed + key * 104729) % MODULUS;
  value = value * 48271 % MODULUS;
  return (value * 48271 % MODULUS) / MODULUS;
}

export interface VillageZone { x: [number, number]; z: [number, number] }
export const VILLAGE_LOTS: readonly VillageZone[] = [
  { x: [-10.5, -8.5], z: [9, 12] },
  { x: [8.5, 10.5], z: [9, 12] },
  { x: [-1.8, 1.8], z: [15.8, 17.3] },
];
export function villagePoint(seed: number, key: number, zone: VillageZone, y = 0): Vector3Tuple {
  return [zone.x[0] + villageSample(seed, key) * (zone.x[1] - zone.x[0]), y,
    zone.z[0] + villageSample(seed, key + 1) * (zone.z[1] - zone.z[0])];
}
export function villageHouse(seed: number, index: number): Vector3Tuple {
  return villagePoint(seed, 10 + index * 4, VILLAGE_LOTS[(seed % 3 + index) % 3]);
}

// These are composed as small coastal groves, not a perimeter picket fence. The two rear
// pockets close the silhouette behind the northern lot while leaving every front garden open.
const COASTAL_GROVE_ZONES: readonly VillageZone[] = [
  { x: [-14, -12.9], z: [-7.1, -4.9] }, { x: [-14, -13.1], z: [-4.5, -2.4] },
  { x: [-14, -13], z: [1.2, 3.8] }, { x: [-14, -12.9], z: [13.6, 16.2] },
  { x: [-13.8, -12.2], z: [16.2, 18.4] }, { x: [-7.3, -4.8], z: [18.4, 19.05] },
  { x: [12.9, 14], z: [-7.1, -4.9] }, { x: [13.1, 14], z: [-4.5, -2.4] },
  { x: [13, 14], z: [1.2, 3.8] }, { x: [12.9, 14], z: [13.6, 16.2] },
  { x: [12.2, 13.8], z: [16.2, 18.4] }, { x: [4.8, 7.3], z: [18.4, 19.05] },
];
export function villageTreeZone(index: number): VillageZone {
  return COASTAL_GROVE_ZONES[index % COASTAL_GROVE_ZONES.length];
}
export function villagePropZone(index: number): VillageZone {
  // Three mail-yard pieces share each outer bay; the two balls get their own inner pockets.
  // All bays sit south of the houses and outside the four-unit-wide delivery spine.
  const bays: readonly VillageZone[] = [
    { x: [-11.9, -10.6], z: [1, 1.7] }, { x: [-10.5, -9.4], z: [1.75, 2.35] },
    { x: [-11.8, -10.6], z: [2.4, 2.75] }, { x: [9.4, 10.5], z: [1, 1.7] },
    { x: [10.5, 11.7], z: [1.75, 2.35] }, { x: [9.55, 10.7], z: [2.4, 2.75] },
    { x: [-5.9, -4.9], z: [1.1, 2] }, { x: [4.9, 5.9], z: [1.1, 2] },
  ];
  return bays[index % bays.length];
}

/** The same hash, expressed as normal editable FeatherScript value nodes. */
export function villageSampleSource(key: string | number): string {
  return `((((Game.PPSeed + (${key}) * 104729) % ${MODULUS}) * 48271 % ${MODULUS}) * 48271 % ${MODULUS}) / ${MODULUS}`;
}

export const VILLAGE_SCATTER_SOURCE = `blueprint Village_Seeded_Placement
var scatter_key: number = 0
var min_x: number = 0
var max_x: number = 0
var min_z: number = 0
var max_z: number = 0
var home_y: number = 0
var scale_min: number = 1
var scale_max: number = 1
var base_scale: vector3 = vec3(1, 1, 1)
var home: vector3 = vec3(0, 0, 0)
var home_rotation: vector3 = vec3(0, 0, 0)
var loose: boolean = false
var pp_rx: number = 0
var pp_rz: number = 0
var pp_size: number = 1
on event PPGenerate(payload):
    self.pp_rx = ${villageSampleSource('self.scatter_key')}
    self.pp_rz = ${villageSampleSource('self.scatter_key + 1')}
    self.pp_size = self.scale_min + (${villageSampleSource('self.scatter_key + 2')}) * (self.scale_max - self.scale_min)
    self.home = vec3(self.min_x + self.pp_rx * (self.max_x - self.min_x), self.home_y, self.min_z + self.pp_rz * (self.max_z - self.min_z))
    self.home_rotation = vec3(0, (${villageSampleSource('self.scatter_key + 3')}) * 360, 0)
    set_position(self, self.home)
    set_rotation(self, self.home_rotation)
    set_scale(self, vec_scale(self.base_scale, self.pp_size))
    set_velocity(self, vec3(0, 0, 0))
    set_angular_velocity(self, vec3(0, 0, 0))
on timer(0.5):
    if self.loose:
        if dot(position(self), vec3(0, 1, 0)) < -4:
            set_position(self, self.home)
            set_velocity(self, vec3(0, 0, 0))
            set_angular_velocity(self, vec3(0, 0, 0))`;

export const VILLAGE_HOUSE_SOURCE = `blueprint Village_Seeded_House
var identity: number = 0
var basket: string = ""
var sign: string = ""
var confetti: string = ""
var path: string = ""
var lot: number = 0
var home: vector3 = vec3(0, 0, 0)
var pp_rx: number = 0
var pp_rz: number = 0
on event PPGenerate(payload):
    self.lot = (Game.PPSeed + self.identity) % 3
    self.pp_rx = ${villageSampleSource('10 + self.identity * 4')}
    self.pp_rz = ${villageSampleSource('11 + self.identity * 4')}
    if self.lot == 0:
        self.home = vec3(-10.5 + self.pp_rx * 2, 0, 9 + self.pp_rz * 3)
    elif self.lot == 1:
        self.home = vec3(8.5 + self.pp_rx * 2, 0, 9 + self.pp_rz * 3)
    else:
        self.home = vec3(-1.8 + self.pp_rx * 3.6, 0, 15.8 + self.pp_rz * 1.5)
    set_position(self, self.home)
    set_position(self.basket, vec_add(self.home, vec3(0, 1, -3.6)))
    set_position(self.sign, vec_add(self.home, vec3(0, 2.8, -3.6)))
    set_position(self.confetti, vec_add(self.home, vec3(0, 1, -3.6)))
    set_position(self.path, vec3(dot(self.home, vec3(1, 0, 0)) * 0.5, 0.035, dot(self.home, vec3(0, 0, 1)) - 3.6))
    set_scale(self.path, vec3(abs(dot(self.home, vec3(1, 0, 0))) + 2.2, 0.035, 2.2))`;
