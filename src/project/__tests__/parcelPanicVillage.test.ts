import { describe, expect, it } from 'vitest';
import { normalizeVillageSeed, villageHouse, villagePoint, villagePropZone, villageSample, villageTreeZone } from '../parcelPanicVillage';

describe('Parcel Panic seeded village plan', () => {
  it('is repeatable, normalizes invalid codes, and changes across different codes', () => {
    expect(normalizeVillageSeed(12345)).toBe(12345);
    expect(normalizeVillageSeed(Number.NaN)).toBeGreaterThan(0);
    expect(normalizeVillageSeed(-12345.7)).toBe(12345);
    expect(normalizeVillageSeed(0)).toBe(1);
    expect(villageHouse(12345, 0)).toEqual(villageHouse(12345, 0));
    expect(villageHouse(12345, 0)).not.toEqual(villageHouse(54321, 0));
  });

  it('keeps 200 generated villages in bounds with distinct house lots and clear approaches', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const homes = [0, 1, 2].map(i => villageHouse(seed * 127, i));
      for (const [x, , z] of homes) {
        expect(Math.abs(x) + 2.4).toBeLessThan(15);
        expect(z + 2.4).toBeLessThan(20);
        expect(z - 3.6).toBeGreaterThan(5);
      }
      for (let i = 0; i < homes.length; i++) for (let j = i + 1; j < homes.length; j++) {
        expect(Math.hypot(homes[i][0] - homes[j][0], homes[i][2] - homes[j][2])).toBeGreaterThan(8);
      }
      for (let i = 0; i < 8; i++) {
        const [x, , z] = villagePoint(seed, 400 + i * 4, villagePropZone(i), 0.7);
        expect(Math.abs(x)).toBeGreaterThan(4);
        expect(z).toBeGreaterThan(1);
        expect(z).toBeLessThan(3);
        for (const house of homes) expect(Math.hypot(x - house[0], z - (house[2] - 3.6))).toBeGreaterThan(2.4);
      }
      for (let i = 0; i < 12; i++) {
        const p = villagePoint(seed, 100 + i * 4, villageTreeZone(i));
        expect(Math.abs(p[0]) > 12 || p[2] > 18).toBe(true);
        expect(Math.abs(p[0])).toBeLessThan(14.7);
        expect(p[2]).toBeLessThan(19.5);
      }
      expect(villageSample(seed, 13)).toBeGreaterThanOrEqual(0);
      expect(villageSample(seed, 13)).toBeLessThan(1);
    }
  });
});
