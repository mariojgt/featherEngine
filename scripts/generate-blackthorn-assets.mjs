import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

// Original modular architecture. Every module stays a separate editable scene object in Feather.
// Merge by material inside each module: hundreds of masonry details cost a handful of draw calls.
const out = 'public/templates/blackthorn';
mkdirSync(out, { recursive: true });
const size=512, heights=new Float32Array(size*size), rgb=Buffer.alloc(size*size*3), normal=Buffer.alloc(size*size*3);
const hash=(x,y)=>{let h=Math.imul(x+71,374761393)+Math.imul(y+29,668265263);h=Math.imul(h^(h>>>13),1274126177);return ((h^(h>>>16))>>>0)/4294967295;};
for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const row=Math.floor(y/64), bx=(x+(row%2)*64)%128, by=y%64;
  const mortar=Math.min(bx,128-bx,by,64-by)<2;
  const stone=hash(Math.floor((x+(row%2)*64)/128),row);
  const grain=hash(x,y), weather=Math.sin(x*.057+Math.sin(y*.03)*2)*Math.sin(y*.071);
  const v=mortar?48:112+stone*47+grain*22+weather*12;
  const k=(y*size+x)*3;
  rgb[k]=v*.85;rgb[k+1]=v*.94;rgb[k+2]=v;
  heights[y*size+x]=mortar?.12:.65+grain*.10+weather*.04;
}
for(let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const get=(x,y)=>heights[((y+size)%size)*size+(x+size)%size];
  const dx=(get(x-1,y)-get(x+1,y))*1.6,dy=(get(x,y-1)-get(x,y+1))*1.6,len=Math.hypot(dx,dy,1),k=(y*size+x)*3;
  normal[k]=(dx/len*.5+.5)*255;normal[k+1]=(dy/len*.5+.5)*255;normal[k+2]=(1/len*.5+.5)*255;
}
await sharp(rgb,{raw:{width:size,height:size,channels:3}}).png().toFile(`${out}/masonry.png`);
await sharp(normal,{raw:{width:size,height:size,channels:3}}).png().toFile(`${out}/masonry-normal.png`);
const banner=`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="512"><rect width="256" height="512" fill="#401729"/><path d="M12 0v500h232V0M24 0v488h208V0" fill="none" stroke="#aa8c52" stroke-width="3"/><path d="M128 90l13 48 35-26-10 54 42 4-34 35 29 26-53 9-22 58-22-58-53-9 29-26-34-35 42-4-10-54 35 26z" fill="#c3a572"/><path d="M128 122v233m0-102-36 42m36-11 34 36" stroke="#301421" stroke-width="7" fill="none"/></svg>`;
await sharp(Buffer.from(banner)).png().toFile(`${out}/blackthorn-banner.png`);

const palette={
  stone:{color:[.54,.57,.61,1],roughness:.76,map:true},
  trim:{color:[.46,.49,.52,1],roughness:.66,map:true},
  roof:{color:[.045,.075,.095,1],roughness:.32,metalness:.3},
  iron:{color:[.07,.06,.065,1],roughness:.4,metalness:.72},
  dark:{color:[.016,.019,.024,1],roughness:.88},
  window:{color:[.94,.36,.055,1],emissive:[1.4,.38,.045],roughness:.3},
  bark:{color:[.18,.14,.13,1],roughness:.95},
};
let bins={};
function add(g,mat,p=[0,0,0],rotation=[0,0,0]) {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...p),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(1,1,1)));
  bins[mat]??=[];bins[mat].push(g.index ? g.toNonIndexed() : g.clone());g.dispose();
}
function box(mat,p,scale,rotation=[0,0,0]) {
  const g=new THREE.BoxGeometry(...scale),uv=g.attributes.uv;
  if(palette[mat].map) for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*Math.max(scale[0],scale[2])*.25,uv.getY(i)*scale[1]*.25);
  add(g,mat,p,rotation);
}
function cylinder(mat,p,r,h,top=r,segments=32) {
  const g=new THREE.CylinderGeometry(top,r,h,segments),uv=g.attributes.uv;
  if(palette[mat].map)for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*r*1.1,uv.getY(i)*h*.25);
  add(g,mat,p);
}
function beam(mat,a,b,width) {
  const direction=new THREE.Vector3(...b).sub(new THREE.Vector3(...a));
  const g=new THREE.CylinderGeometry(width*.65,width,direction.length(),7);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize()));
  add(g,mat,a.map((v,i)=>(v+b[i])/2));
}
async function save(name) {
  const d=new Document(),buffer=d.createBuffer(),scene=d.createScene(name).setExtras({ featherPreserveScale: true, authoringUnits: 'metres' }),mesh=d.createMesh(name);
  const tex=d.createTexture('Original ashlar').setImage(readFileSync(`${out}/masonry.png`)).setMimeType('image/png');
  const norm=d.createTexture('Ashlar relief').setImage(readFileSync(`${out}/masonry-normal.png`)).setMimeType('image/png');
  let triangles=0;
  for(const [key,geometries] of Object.entries(bins)) {
    const g=mergeGeometries(geometries),v=palette[key];
    const m=d.createMaterial(key).setBaseColorFactor(v.color).setRoughnessFactor(v.roughness).setMetallicFactor(v.metalness??0);
    if(v.map){m.setBaseColorTexture(tex).setNormalTexture(norm).setNormalScale(.7);m.getBaseColorTextureInfo().setWrapS(10497).setWrapT(10497);m.getNormalTextureInfo().setWrapS(10497).setWrapT(10497);}
    if(v.emissive)m.setEmissiveFactor(v.emissive.map(c=>Math.min(1,c)));
    const p=d.createPrimitive().setMaterial(m);
    for(const [attr,type] of [['position','VEC3'],['normal','VEC3'],['uv','VEC2']]) {
      p.setAttribute({position:'POSITION',normal:'NORMAL',uv:'TEXCOORD_0'}[attr],d.createAccessor().setType(type).setArray(new Float32Array(g.attributes[attr].array)).setBuffer(buffer));
    }
    mesh.addPrimitive(p);triangles+=g.attributes.position.count/3;g.dispose();geometries.forEach(g=>g.dispose());
  }
  scene.addChild(d.createNode(name).setMesh(mesh));
  const bytes=await new NodeIO().writeBinary(d);writeFileSync(`${out}/${name}.glb`,bytes);
  console.log(`${name}: ${triangles} triangles, ${Object.keys(bins).length} material batches, ${(bytes.length/1024).toFixed(0)} KiB`);bins={};
}

// Roofed round tower: battered footing, corbels, arrow slits, copper spire, weathered stone courses.
cylinder('stone',[0,9.5,0],3.6,19,3.25);
cylinder('trim',[0,.55,0],4.15,1.1,3.95);
for(const y of [3,8,14,18.7])cylinder('trim',[0,y,0],3.69-(y/19)*.35,.28);
for(let i=0;i<12;i++){
 const a=i*Math.PI/6,x=Math.cos(a),z=Math.sin(a);
 box('trim',[x*3.45,18.2,z*3.45],[.65,1.4,.65],[0,-a,0]);
 box('stone',[x*3.62,19.6,z*3.62],[.8,1.15,.8],[0,-a,0]);
 if(i%2===0)for(const y of [6,12,16]){
  box('dark',[x*3.49,y,z*3.49],[.65,2.1,.10],[0,Math.PI/2-a,0]);
  box('window',[x*3.555,y,z*3.555],[.17,1.3,.035],[0,Math.PI/2-a,0]);
 }
}
cylinder('roof',[0,24,0],4.35,10,.04);
for(let i=0;i<12;i++){const a=i*Math.PI/6;beam('iron',[Math.cos(a)*4.32,19.02,Math.sin(a)*4.32],[0,29,0],.04);}
cylinder('iron',[0,30,0],.11,3,.015,12);
await save('spire-tower');

// Keep with a steep gabled roof and narrow orange lancets.
box('stone',[0,11,0],[21,22,15]);box('trim',[0,.6,0],[24,1.2,18]);
for(const y of [6,13,21.5])box('trim',[0,y,0],[21.5,.28,15.5]);
for(const x of [-10.5,-5.2,0,5.2,10.5])for(const side of [-1,1]){
 box('trim',[x,10,side*7.8],[1.2,20,1.9]);box('trim',[x,20.5,side*7.8],[1.7,.4,2.2]);
}
for(const x of [-7.8,-2.6,2.6,7.8])for(const y of [5,11,17])for(const side of [-1,1]){
 box('dark',[x,y,side*7.53],[1.6,3.5,.08]);
 box('window',[x,y,side*7.58],[.65,2.8,.03]);
 box('iron',[x,y,side*7.62],[.055,3,.04]);box('iron',[x,y+.2,side*7.63],[.7,.07,.04]);
}
const roofShape=new THREE.Shape().moveTo(-12,0).lineTo(0,10).lineTo(12,0).closePath();
const roof=new THREE.ExtrudeGeometry(roofShape,{depth:17,bevelEnabled:false,steps:1});roof.translate(0,22,-8.5);add(roof,'roof');
for(let z=-8.5;z<=8.5;z+=1.4){beam('iron',[-12,22,z],[0,32,z],.045);beam('iron',[12,22,z],[0,32,z],.045);}
for(const z of [-8.2,8.2])cylinder('iron',[0,33,z],.15,3,.015,10);
await save('great-hall');

// Curtain wall, crenellation and repeated support piers.
box('stone',[0,5,0],[18,10,2.6]);box('trim',[0,.5,0],[19,1,3.8]);box('trim',[0,9.6,0],[18.7,.45,3.3]);
for(let i=0;i<10;i++)box('stone',[-8.4+i*1.86,10.7,0],[.9,1.5,3]);
for(const x of [-7,0,7]){box('trim',[x,4.5,1.5],[1.5,9,2.3]);box('trim',[x,8.5,1.7],[1.9,.5,2.8]);}
await save('curtain-wall');

// A real open arch (no flat dark rectangle hiding a solid wall), iron portcullis behind it.
for(const x of [-6.2,6.2])box('stone',[x,5.5,0],[4,11,6]);
for(let i=0;i<19;i++){
 const a=i/18*Math.PI;
 box('trim',[Math.cos(a)*4.35,6+Math.sin(a)*4.35,2.8],[.85,1.05,1.1],[0,0,a]);
}
box('stone',[0,12.2,0],[16,3.5,6]);box('trim',[0,14.1,0],[17,.45,6.8]);
for(let x=-7.4;x<=7.5;x+=1.85)box('stone',[x,15.1,0],[.95,1.6,6]);
for(let x=-3.6;x<=3.7;x+=.6)box('iron',[x,4,-1],[.1,8,.13]);
for(const y of [1.7,4.5,7])box('iron',[0,y,-1],[8,.15,.15]);
for(const x of [-6.2,6.2])box('window',[x,11.8,3.02],[.55,1.8,.06]);
await save('gatehouse');

// Wind-scoured dead trees. Branches have irregular tapered geometry, not stacked boxes.
beam('bark',[0,0,0],[.4,8.5,.2],.58);
for(let i=0;i<9;i++){
 const a=i*2.4,y=2+i*.62,tip=[Math.cos(a)*(2+i*.13),y+2.3,Math.sin(a)*(2+i*.13)];
 beam('bark',[.15,y,0],tip,.16+(9-i)*.014);
 beam('bark',tip,[tip[0]*1.3,tip[1]+1.1,tip[2]*1.25],.07);
 beam('bark',tip,[tip[0]*.75+.3,tip[1]+1.5,tip[2]*.8],.055);
}
await save('blackthorn-tree');

// Natural low-poly boulders: seeded displacement avoids smooth spheres and repetitive box silhouettes.
for(let i=0;i<3;i++){
 const g=new THREE.IcosahedronGeometry(1,2),p=g.attributes.position;
 for(let j=0;j<p.count;j++){
  const x=p.getX(j),y=p.getY(j),z=p.getZ(j),n=1+.15*Math.sin(x*6+z*4+i)*Math.cos(y*5-x*3);
  p.setXYZ(j,x*n,y*.72*n,z*n*.85);
 }
 g.computeVertexNormals();add(g,'stone');await save(`moor-rock-${i+1}`);
}
console.log('Blackthorn architecture, original masonry maps and heraldic cloth ready.');
