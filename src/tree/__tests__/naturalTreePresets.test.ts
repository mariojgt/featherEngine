import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildSkeleton, generateTree } from '../generateTree';
import { naturalTreeSpec, type NaturalTreeKind } from '../naturalTreePresets';
import { naturalBarkTexture, naturalBirchBarkTexture, naturalLeafTexture, naturalNeedleTexture } from '../surfaceTextures';
import { normalizeTreeSpec, treeRng } from '../treeSpec';

const KINDS: NaturalTreeKind[] = ['broadleaf', 'birch', 'shrub', 'conifer'];

describe('natural tree presets', () => {
  it('is explicitly opt-in and supplies stable ids, names, surface defaults, and leaf-scale foliage', () => {
    const legacy = normalizeTreeSpec({ id: 'legacy' } as never);
    expect(legacy.foliage.strategy).toBe('clusters');
    expect(legacy.look.surface.style).toBe('stylized');
    expect(normalizeTreeSpec({ id: 'invalid', foliage: { strategy: 'giant-cards' } } as never).foliage.strategy).toBe('clusters');
    expect(normalizeTreeSpec({ id: 'leaves', foliage: { strategy: 'leaves' } } as never).foliage.strategy).toBe('leaves');

    for (const kind of KINDS) {
      const spec = naturalTreeSpec(kind);
      expect(spec.id).toBe(`natural-${kind}`);
      expect(spec.name).toMatch(/^Natural /);
      expect(spec.foliage.strategy).toBe('leaves');
      expect(spec.look.surface.style).toBe('natural');
      expect(spec.foliage.size).toBeGreaterThanOrEqual(0.05);
      expect(spec.foliage.size).toBeLessThanOrEqual(0.18);
      expect(Math.max(...spec.wind.levelMultiplier)).toBeLessThan(1);
    }

    const named = naturalTreeSpec('broadleaf', 'field-oak', 'Field Oak');
    expect([named.id, named.name]).toEqual(['field-oak', 'Field Oak']);
  });

  it('keeps natural geometry deterministic and within the explicit desktop triangle budget', () => {
    for (const kind of KINDS) {
      const spec = naturalTreeSpec(kind);
      const first = generateTree(spec, 9182);
      const second = generateTree(spec, 9182);
      expect(first.triangles, kind).toBeLessThan(30_000);
      expect(first.triangles, kind).toBeGreaterThan(400);
      expect(first.foliage, kind).toBeTruthy();
      expect(Array.from(first.foliage!.getAttribute('position').array), kind).toEqual(
        Array.from(second.foliage!.getAttribute('position').array),
      );
      expect(first.triangles, kind).toBe(second.triangles);
      first.bark.dispose(); first.foliage?.dispose();
      second.bark.dispose(); second.foliage?.dispose();
    }
  });

  it('uses genuinely small broadleaf cards attached to authored branches with bounded wind', () => {
    const spec = naturalTreeSpec('broadleaf');
    const seed = 4421;
    const tree = generateTree(spec, seed);
    const foliage = tree.foliage!;
    expect(foliage.boundingBox!.min.y).toBeGreaterThan(spec.trunk.height * 0.25);
    for (const attribute of ['color', 'aWind', 'aTrunkT', 'aCardDelta', 'aCardOffset']) {
      expect(foliage.getAttribute(attribute), attribute).toBeTruthy();
    }
    const position = foliage.getAttribute('position');
    const index = foliage.getIndex()!;
    let longestTriangleEdge = 0;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    for (let i = 0; i < index.count; i += 3) {
      const triangle = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      for (let edge = 0; edge < 3; edge += 1) {
        a.fromBufferAttribute(position, triangle[edge]);
        b.fromBufferAttribute(position, triangle[(edge + 1) % 3]);
        longestTriangleEdge = Math.max(longestTriangleEdge, a.distanceTo(b));
      }
    }
    // Includes a card diagonal; individual authored leaf length is 17 cm with bounded variance.
    expect(longestTriangleEdge).toBeLessThan(0.26);

    const branches = buildSkeleton(spec, treeRng(seed));
    const samples: THREE.Vector3[] = [];
    for (const branch of branches) {
      for (let step = 0; step <= 32; step += 1) samples.push(branch.path.getPoint(step / 32));
    }
    // PlaneGeometry contributes four vertices per leaf. Its centre must remain on the twig within
    // half a leaf length, rather than being scattered through an abstract crown volume.
    const center = new THREE.Vector3();
    const vertex = new THREE.Vector3();
    for (let leaf = 0; leaf < position.count; leaf += 4) {
      center.set(0, 0, 0);
      for (let corner = 0; corner < 4; corner += 1) center.add(vertex.fromBufferAttribute(position, leaf + corner));
      center.multiplyScalar(0.25);
      const nearest = samples.reduce((distance, sample) => Math.min(distance, center.distanceTo(sample)), Infinity);
      expect(nearest).toBeLessThan(0.14);
    }

    const wind = foliage.getAttribute('aWind');
    for (let i = 0; i < wind.count; i += 1) expect(wind.getX(i)).toBeLessThanOrEqual(0.82);
    tree.bark.dispose(); foliage.dispose();
  });

  it('retains complete natural leaf cards across stable LOD selection', () => {
    const spec = naturalTreeSpec('birch');
    const full = generateTree(spec, 71);
    const medium = generateTree(spec, 71, { lod: 1 });
    const far = generateTree(spec, 71, { lod: 2 });
    expect(medium.foliage!.getAttribute('position').count % 4).toBe(0);
    expect(far.foliage!.getAttribute('position').count % 4).toBe(0);
    const centre = (geometry: THREE.BufferGeometry, first: number) => {
      const p = geometry.getAttribute('position'), v = new THREE.Vector3(), result = new THREE.Vector3();
      for (let i = 0; i < 4; i++) result.add(v.fromBufferAttribute(p, first + i));
      return result.multiplyScalar(0.25);
    };
    for (let i = 0; i < medium.foliage!.getAttribute('position').count; i += 4) {
      expect(centre(medium.foliage!, i).distanceTo(centre(full.foliage!, i * 2))).toBeLessThan(0.00001);
    }
    const area = (geometry: THREE.BufferGeometry) => {
      const p = geometry.getAttribute('position'), index = geometry.getIndex()!;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let total = 0;
      for (let i = 0; i < index.count; i += 3) {
        a.fromBufferAttribute(p, index.getX(i)); b.fromBufferAttribute(p, index.getX(i + 1)); c.fromBufferAttribute(p, index.getX(i + 2));
        total += b.sub(a).cross(c.sub(a)).length() * 0.5;
      }
      return total;
    };
    expect(area(medium.foliage!) / area(full.foliage!)).toBeGreaterThan(0.85);
    expect(area(far.foliage!) / area(full.foliage!)).toBeGreaterThan(0.85);
    expect(medium.triangles).toBeLessThan(full.triangles);
    expect(far.triangles).toBeLessThan(medium.triangles);
    for (const generated of [full, medium, far]) {
      generated.bark.dispose(); generated.foliage?.dispose();
    }
  });

  it('provides cached cutout foliage and distinct bark surfaces without external assets', () => {
    for (const texture of [naturalLeafTexture(), naturalNeedleTexture()]) {
      const data = texture.image.data as Uint8Array;
      const alpha = Array.from({ length: data.length / 4 }, (_, pixel) => data[pixel * 4 + 3]);
      expect(Math.min(...alpha)).toBe(0);
      expect(Math.max(...alpha)).toBe(255);
      expect(texture.wrapS).toBe(THREE.ClampToEdgeWrapping);
    }
    expect(naturalLeafTexture()).toBe(naturalLeafTexture());
    expect(naturalBarkTexture()).not.toBe(naturalBirchBarkTexture());
  });
});
