import { describe, expect, it } from 'vitest';
import { withTerrainDefaults } from './terrain';
import { generateVegetationChunk } from './vegetation';
import { canopyCover, generateGroundCover, GROUND_COVER_KINDS, woodlandCanopies } from './woodland';
import { sampleWoodlandHabitat, spacedTreeCandidates } from './vegetationRules';
import { limitVegetation, vegetationSignatures } from './vegetationCache';

const chunk = (x: number, z: number) => ({ x, z, id: `${x}:${z}` });
const woodland = () => {
  const t = withTerrainDefaults({ size: 256, chunkSize: 32, heightScale: 0, seed: 1431 });
  return withTerrainDefaults({ ...t, foliage: { ...t.foliage, enabled: true, mode: 'mixed', treeSpacing: 6,
    treeDensity: 1, density: .7, grassMesh: 'natural', distribution: 'woodland', understoryAssetId: 'library', understoryDensity: 1 } });
};
const positions = (m: ReturnType<typeof generateGroundCover>) => GROUND_COVER_KINDS.flatMap(kind => m[kind].map(matrix => `${kind}:${matrix.elements[12]}:${matrix.elements[14]}`)).sort();

describe('woodland ecology', () => {
  it('defaults existing terrain to uniform scatter and disabled ground cover', () => {
    const t = withTerrainDefaults({});
    expect(t.foliage.distribution).toBe('uniform');
    expect(t.foliage.understoryDensity).toBe(0);
    expect(positions(generateGroundCover(t, chunk(0,0), []))).toEqual([]);
  });
  it('clusters spaced trees continuously across seams and generation order', () => {
    const t = woodland(), chunks = [chunk(0,0),chunk(1,0),chunk(0,1),chunk(1,1)];
    const a = chunks.flatMap(c => spacedTreeCandidates(t,c));
    const b = chunks.reverse().flatMap(c => spacedTreeCandidates(t,c));
    expect(a.length).toBeGreaterThan(5);
    expect(a.sort((x,y)=>x.key-y.key)).toEqual(b.sort((x,y)=>x.key-y.key));
    for (let i=0;i<a.length;i++) for(let j=i+1;j<a.length;j++) expect(Math.hypot(a[i].x-a[j].x,a[i].z-a[j].z)).toBeGreaterThanOrEqual(6);
    expect(Math.abs(sampleWoodlandHabitat(t.seed,32-.001,12)-sampleWoodlandHabitat(t.seed,32+.001,12))).toBeLessThan(.001);
    const left = woodlandCanopies(t,chunk(0,0)), right = woodlandCanopies(t,chunk(1,0));
    for(let z=0;z<32;z+=2) expect(canopyCover(left,32,z)).toBeCloseTo(canopyCover(right,32,z),10);
  });
  it('keeps ground cover deterministic, rooted and unique across neighboring cells', () => {
    const t=woodland(), c=chunk(0,0), a=generateGroundCover(t,c,woodlandCanopies(t,c));
    expect(positions(a).length).toBeGreaterThan(10);
    expect(positions(generateGroundCover(t,c,woodlandCanopies(t,c)))).toEqual(positions(a));
    const all=[...positions(a),...positions(generateGroundCover(t,chunk(1,0),woodlandCanopies(t,chunk(1,0))))];
    expect(new Set(all).size).toBe(all.length);
    for(const kind of GROUND_COVER_KINDS) for(const m of a[kind]) {
      const scale = m.getMaxScaleOnAxis();
      expect(m.elements[13]).toBeCloseTo(-.025-(kind==='rock'?.12*scale:kind==='wood'?.03*scale:0));
    }
  });
  it('obeys masks, elevation, density and painted rock exclusions', () => {
    const t=woodland(), c=chunk(0,0);
    for (const patch of [{ usePaintMask:true },{ understoryDensity:0 },{ minElevation:1 }]) {
      const excluded={...t,foliage:{...t.foliage,...patch}};
      expect(positions(generateGroundCover(excluded,c,woodlandCanopies(excluded,c)))).toEqual([]);
    }
    const rock={...t, paintOverrides:Object.fromEntries(Array.from({length:36},(_,i)=>[`${i%6}:${Math.floor(i/6)}`,t.materialLayers[2].id])),editSpacing:8};
    const cover=generateGroundCover(rock,c,[]);
    expect(cover.fern.length+cover.wood.length).toBe(0);
  });
  it('thins grass under accepted canopies and budgets ground cover across all regions', () => {
    const t=woodland(), c=chunk(0,0), data=generateVegetationChunk(t,c);
    const withoutTrees=generateVegetationChunk({...t,foliage:{...t.foliage,treeDensity:0}},c);
    expect(data.grass.length).toBeLessThan(withoutTrees.grass.length);
    const budget={grass:0,trees:0,flowers:0,groundCover:7};
    const a=limitVegetation(data,budget),b=limitVegetation(data,budget);
    expect(positions(a.groundCover).length+positions(b.groundCover).length).toBe(7);
    const edited={...t, heightOverrides:{'15:4':3}};
    expect(vegetationSignatures(edited).chunks.has('1:0')).toBe(true);
  });
});
