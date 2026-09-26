import type { CinematicCameraKeyframe, TerrainComponent, Vector3Tuple } from '../types';
import { sampleTerrainLocalHeight, terrainEditKey, withTerrainDefaults } from '../terrain/terrain';
import { terrainBiomePatch } from '../terrain/biomes';
import { verdantRocks, verdantTreeClearance } from './verdantScenery';
import { generateVegetationChunk } from '../terrain/vegetation';

export const VERDANT_DURATION = 48;
export interface VerdantShot { label: string; start: number; end: number; keys: CinematicCameraKeyframe[] }

/** Fixed seed and terrain-local cameras make the shipped template reproducible and fully editable. */
export function verdantTerrain(): TerrainComponent {
  const terrain = terrainBiomePatch(withTerrainDefaults({ size: 320, chunkSize: 48, resolution: 40,
    streamRadius: 3, physicsRadius: 1, seed: 1431, heightScale: 20, frequency: .01,
    octaves: 5, persistence: .45, domainWarp: 18, ridgeStrength: .16 }), 'woodland');
  const rocks = verdantRocks(terrain);
  const paintOverrides: Record<string, string> = {}, foliageOverrides: Record<string, number> = {};
  for (let iz = -80; iz <= 80; iz++) for (let ix = -80; ix <= 80; ix++) {
    const x = ix * 2, z = iz * 2, key = terrainEditKey(ix, iz);
    const edge = Math.min(...rocks.map(r => Math.hypot(x-r.position[0],z-r.position[2])-r.radius*.72));
    const trail = Math.abs(x + 7 - Math.sin(z*.105)*3);
    if (edge < 1.6 || (trail < 1.2 && z > -32 && z < 34)) paintOverrides[key] = terrain.materialLayers[edge < -1.6 ? 2 : 1].id;
    foliageOverrides[key] = edge < .7 ? 0 : 1;
  }
  return withTerrainDefaults({ ...terrain, paintOverrides, foliageOverrides,
    materialLayers: terrain.materialLayers.map((layer,i)=>i===0?{...layer,color:'#a9bc8b'}:layer), foliage: { ...terrain.foliage,
    density: 1, treeDensity: .9, treeSpacing: 7, minScale: .48, maxScale: 1.18, usePaintMask: true,
    understoryDensity: 1, flowerDensity: 0, windStrength: .45,
    grassColor: '#8f9b71', stylizedGrass: { ...terrain.foliage.stylizedGrass!,
      gradientTop: '#bcc492', gradientBottom: '#46533b', fadeStart: 35, fadeEnd: 70 } } });
}

export function verdantShotPlan(terrain: TerrainComponent): { shots: VerdantShot[]; hero: Vector3Tuple; fern: Vector3Tuple } {
  const cells = [];
  for (let z=-1;z<=1;z++) for(let x=-1;x<=1;x++) cells.push({x,z,id:`${x}:${z}`});
  const vegetation = cells.map(c => generateVegetationChunk(terrain,c,{grass:false,flowers:false}));
  const woodClearance = verdantTreeClearance(vegetation.flatMap(v=>v.treeModels));
  const treeMatrices = vegetation.flatMap(v => v.treeModels);
  const trees = treeMatrices.map(m => [m.elements[12],m.elements[13],m.elements[14]] as Vector3Tuple);
  const plants = vegetation.flatMap(v => v.groundCover.fern.map(m => [m.elements[12],m.elements[13],m.elements[14]] as Vector3Tuple));
  const rocks = verdantRocks(terrain);
  const height = (x:number,z:number) => sampleTerrainLocalHeight(terrain,x,z);
  const at = (x:number,y:number,z:number):Vector3Tuple => [x,height(x,z)+y,z];
  const clearance = (x:number,z:number) => trees.reduce((d,t) => Math.min(d,Math.hypot(x-t[0],z-t[2])),Infinity);
  trees.sort((a,b)=>Math.hypot(a[0]+6,a[2]-10)-Math.hypot(b[0]+6,b[2]-10));
  const hero = trees.find(t=>clearance(t[0]+4,t[2]+5)>2.3) ?? trees[0] ?? at(0,0,0);
  const [hx,,hz] = hero;
  plants.sort((a,b)=>Math.hypot(a[0]-hx,a[2]-hz-6)-Math.hypot(b[0]-hx,b[2]-hz-6));
  const fern = plants.find(p=>clearance(p[0]-1.7,p[2]+3.3)>2.4 && clearance(p[0]-1.1,p[2]+2.7)>2.4) ?? plants[0] ?? at(hx+3,0,hz+5);
  const [fx,fy,fz] = fern;
  const shot = (label:string,start:number,end:number,from:Vector3Tuple,to:Vector3Tuple,target:Vector3Tuple,fov:number,aperture=0):VerdantShot => {
    // Search translated dolly corridors; sample the entire segment against trunks and scan bounds.
    const offsets = [0, 2, -2, 4, -4, 7, -7, 11, -11, 16, -16, 22, -22];
    const shifts = offsets.flatMap(x => offsets.map(z => [x,z])).sort((a,b)=>Math.hypot(...a)-Math.hypot(...b));
    const shift = shifts.find(([dx,dz]) => Array.from({length:81},(_,i)=>i/80).every(t => {
      const x=from[0]+(to[0]-from[0])*t+dx,z=from[2]+(to[2]-from[2])*t+dz;
      const y=height(x,z)+from[1]+(to[1]-from[1])*t;
      return clearance(x,z)>2.3 && woodClearance([x,y,z])>1 && rocks.every(r=>y>r.top+1 || Math.hypot(x-r.position[0],z-r.position[2])>r.radius+1);
    }));
    if (!shift) throw new Error(`No clear Verdant camera corridor: ${label}`);
    const keys = Array.from({length:9},(_,i) => {
      const t=i/8, x=from[0]+(to[0]-from[0])*t+shift[0], z=from[2]+(to[2]-from[2])*t+shift[1];
      const position=at(x,from[1]+(to[1]-from[1])*t,z);
      return { time:start+(end-start)*t, position, lookAt:target, fov, aperture,
        focusDistance:Math.hypot(...position.map((v,k)=>v-target[k])) };
    });
    return {label,start,end,keys};
  };
  // Pick a slow dolly corridor with actual trunk clearance, instead of flying through a random grove.
  const corridors = [-12,-8,8,12].map(offset => ({offset, clearance:Math.min(...Array.from({length:25},(_,i)=>clearance(hx+offset,hz+20-i*.4)))}));
  corridors.sort((a,b)=>b.clearance-a.clearance);
  const cx=hx+corridors[0].offset;
  return {hero,fern,shots:[
    shot('01 · Small beginnings / fern and leaf litter',0,8,[fx-1.7,.95,fz+3.3],[fx-1.1,.85,fz+2.7],[fx,fy+.25,fz],48,.08),
    shot('02 · Time in the bark / tree portrait',8,16,[hx+4,1.8,hz+5],[hx+3.1,2.3,hz+5.7],[hx,hero[1]+2.6,hz],44,.04),
    shot('03 · Through the grove / grass and understorey',16,25,[cx,2.2,hz+20],[cx,2.5,hz+10.4],[-5,height(-5,1)+2,1],58),
    shot('04 · Into the light / canopy ascent',25,34,[hx+8,21,hz+11],[hx+10,27,hz+14],[-5,height(-5,1)+3,1],52),
    shot('05 · A living landscape / ridge reveal',34,43,[hx+17,24,hz+30],[hx+23,28,hz+36],[-5,height(-5,1)+1,1],56),
    shot('06 · Verdant / closing woodland vista',43,48,[cx-3,3.5,hz+24],[cx-4,4,hz+29],[-5,height(-5,1)+3,-5],56),
  ]};
}
