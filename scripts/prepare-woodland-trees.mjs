/** Rebuild the bundled CC0 tree library from the pinned source files in its provenance manifest.
 * Run from the repository root: node scripts/prepare-woodland-trees.mjs [cache-directory] [output.glb]
 * Requires the existing sharp and meshoptimizer development dependencies; no Blender/runtime downloads.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { MeshoptSimplifier } = await import('meshoptimizer');
await MeshoptSimplifier.ready;
const root = path.resolve(process.argv[2] ?? '/tmp/feather-woodland-sources');
const output = path.resolve(process.argv[3] ?? 'src/terrain/models/woodland-trees.glb');
const manifest = JSON.parse(fs.readFileSync('src/terrain/models/provenance.json', 'utf8'));
for (const source of manifest.sources) {
  for (const file of source.files) {
    const basename = path.basename(new URL(file.url).pathname);
    const relative = basename.endsWith('.gltf') ? source.asset + '.gltf' : basename.endsWith('.bin') ? basename : 'textures/' + basename;
    const destination = path.join(root, source.asset, relative);
    let bytes = fs.existsSync(destination) ? fs.readFileSync(destination) : null;
    if (!bytes || crypto.createHash('md5').update(bytes).digest('hex') !== file.md5) {
      const response = await fetch(file.url, { headers: { 'User-Agent': 'FeatherEngine-AssetPreparation/1.0' } });
      if (!response.ok) throw new Error('Download failed: ' + file.url);
      bytes = Buffer.from(await response.arrayBuffer());
      if (crypto.createHash('md5').update(bytes).digest('hex') !== file.md5) throw new Error('Source checksum changed: ' + file.url);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
    }
  }
}
// The source meshes contain disconnected individual leaves. Weld positions only for component
// discovery, retaining each component's original UVs and placement when fitting the replacement cards.
for(const name of ['tree_small_02','island_tree_02']){const dir=root+'/'+name,d=JSON.parse(fs.readFileSync(dir+'/'+name+'.gltf')),bin=fs.readFileSync(dir+'/'+name+'.bin');const p=d.meshes[0].primitives.find(p=>d.materials[p.material].name.includes('leaves'));
function read(i){const a=d.accessors[i],v=d.bufferViews[a.bufferView],T=a.componentType===5126?Float32Array:Uint32Array,n=a.type==='VEC3'?3:a.type==='VEC2'?2:1;return new T(bin.buffer.slice(bin.byteOffset+v.byteOffset+(a.byteOffset??0),bin.byteOffset+v.byteOffset+(a.byteOffset??0)+a.count*n*4));}
const pos=read(p.attributes.POSITION),uv=read(p.attributes.TEXCOORD_0),idx=read(p.indices),count=pos.length/3;const remap=MeshoptSimplifier.generatePositionRemap(pos,3),parent=new Uint32Array(count);for(let i=0;i<count;i++)parent[i]=i;
function find(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}for(let i=0;i<idx.length;i+=3){const a=find(remap[idx[i]]),b=find(remap[idx[i+1]]),c=find(remap[idx[i+2]]);parent[b]=a;parent[c]=a;}
const groups=new Map();for(let i=0;i<count;i++){const j=find(remap[i]);const arr=groups.get(j)??[];arr.push(i);groups.set(j,arr);}const hist={};for(const g of groups.values())hist[g.length]=(hist[g.length]??0)+1;fs.writeFileSync(root+'/'+name+'-leaf-components.json',JSON.stringify([...groups.values()]));}

const out={asset:{version:'2.0',generator:'Feather authored woodland preparation'},scene:0,scenes:[{nodes:[],extras:{featherTreeLibrary:true}}],nodes:[],meshes:[],materials:[],textures:[],images:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],buffers:[],bufferViews:[],accessors:[]};
let size=0;const bins=[];const report=[];
function blob(bytes){const b=Buffer.from(bytes.buffer??bytes,bytes.byteOffset??0,bytes.byteLength??bytes.length);const v=out.bufferViews.push({buffer:0,byteOffset:size,byteLength:b.length})-1;bins.push(b);size+=b.length;const padding=(4-size%4)%4;if(padding){bins.push(Buffer.alloc(padding));size+=padding;}return v;}
function accessor(array,type,componentType,normalize=false){const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type];const a={bufferView:blob(array),componentType,count:array.length/components,type};if(normalize)a.normalized=true;if(type==='VEC3'&&componentType===5126){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<array.length;i++){const j=i%3;a.min[j]=Math.min(a.min[j],array[i]);a.max[j]=Math.max(a.max[j],array[i]);}}return out.accessors.push(a)-1;}
for(const [variant,name] of ['tree_small_02','island_tree_02'].entries()){
 const dir=root+'/'+name,d=JSON.parse(fs.readFileSync(dir+'/'+name+'.gltf')),bin=fs.readFileSync(dir+'/'+name+'.bin');
 const scale=variant===0?1.65:2.25;const height=variant===0?7.48:7.63;
 function read(i){const a=d.accessors[i],v=d.bufferViews[a.bufferView];const nc={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type],types={5126:Float32Array,5125:Uint32Array,5123:Uint16Array};const T=types[a.componentType],s=T.BYTES_PER_ELEMENT,arr=new T(a.count*nc),stride=v.byteStride??s*nc;for(let n=0;n<a.count;n++)for(let k=0;k<nc;k++){const p=v.byteOffset+(a.byteOffset??0)+n*stride+k*s;arr[n*nc+k]=a.componentType===5126?bin.readFloatLE(p):a.componentType===5125?bin.readUInt32LE(p):bin.readUInt16LE(p);}return arr;}
 const materialOffset=out.materials.length;
 for(const m0 of d.materials){const m=structuredClone(m0);delete m.extensions;m.name=name+':'+m.name;m.doubleSided=m.name.includes('leaves');if(m.name.includes('leaves')){m.alphaMode='MASK';m.alphaCutoff=.38;}else delete m.alphaMode;
  async function texture(info,kind){if(!info)return;const img=d.images[d.textures[info.index].source];let image=sharp(dir+'/'+img.uri);const leaf=m.name.includes('leaves');const target=kind==='albedo'?1024:512;
   if(kind==='albedo'&&leaf){const rgb=await image.resize(target,target,{fit:'fill'}).removeAlpha().raw().toBuffer();const alpha=await sharp(dir+'/textures/'+name+'_leaves_alpha_1k.png').resize(target,target,{fit:'fill'}).greyscale().raw().toBuffer();image=sharp(rgb,{raw:{width:target,height:target,channels:3}}).joinChannel(alpha,{raw:{width:target,height:target,channels:1}});}
   else image=image.resize(target,target,{fit:'fill'});
   const alpha=kind==='albedo'&&leaf;const bytes=await (alpha?image.png({compressionLevel:9}):image.jpeg({quality:kind==='normal'?95:90,chromaSubsampling:'4:4:4'})).toBuffer();
   const imageIndex=out.images.push({bufferView:blob(bytes),mimeType:alpha?'image/png':'image/jpeg',name:m.name+' '+kind})-1;
   const textureIndex=out.textures.push({sampler:0,source:imageIndex})-1;info.index=textureIndex;
  }
  await texture(m.pbrMetallicRoughness.baseColorTexture,'albedo');await texture(m.normalTexture,'normal');await texture(m.pbrMetallicRoughness.metallicRoughnessTexture,'roughness');
  m.occlusionTexture=structuredClone(m.pbrMetallicRoughness.metallicRoughnessTexture);m.occlusionTexture.strength=m.name.includes('leaves')?.25:.75;
  m.pbrMetallicRoughness.metallicFactor=0;out.materials.push(m);
 }
 function leafCards(source, lod) {
 const groups=JSON.parse(fs.readFileSync(root+'/'+name+'-leaf-components.json'));
 const positions=[],normals=[],uvs=[],indices=[];const p=source.attrs.POSITION,uv=source.attrs.TEXCOORD_0,n=source.attrs.NORMAL;
 for(let ci=0;ci<groups.length;ci++){
  if(lod===1 && ((Math.imul(ci+1,2654435761)>>>0)%2)!==0)continue;
  if(lod===2 && ((Math.imul(ci+1,2654435761)>>>0)%8)!==0)continue;
  const g=groups[ci];let mu=0,mv=0;const c=[0,0,0],normal=[0,0,0];let minU=Infinity,minV=Infinity,maxU=-Infinity,maxV=-Infinity;
  for(const i of g){mu+=uv[i*2];mv+=uv[i*2+1];minU=Math.min(minU,uv[i*2]);maxU=Math.max(maxU,uv[i*2]);minV=Math.min(minV,uv[i*2+1]);maxV=Math.max(maxV,uv[i*2+1]);for(let k=0;k<3;k++){c[k]+=p[i*3+k];normal[k]+=n[i*3+k];}}
  mu/=g.length;mv/=g.length;for(let k=0;k<3;k++)c[k]/=g.length;
  let uu=0,vv=0,uvc=0;const pu=[0,0,0],pv=[0,0,0];for(const i of g){const u=uv[i*2]-mu,v=uv[i*2+1]-mv;uu+=u*u;vv+=v*v;uvc+=u*v;for(let k=0;k<3;k++){pu[k]+=(p[i*3+k]-c[k])*u;pv[k]+=(p[i*3+k]-c[k])*v;}}
  const det=uu*vv-uvc*uvc;if(det<1e-15)continue;const U=pu.map((x,k)=>(x*vv-pv[k]*uvc)/det),V=pv.map((x,k)=>(x*uu-pu[k]*uvc)/det);
  const len=Math.hypot(...normal)||1;for(let k=0;k<3;k++)normal[k]/=len;
  const first=positions.length/3,inflate=[1,1.12,1.5][lod];for(const [u,v]of[[minU,minV],[maxU,minV],[maxU,maxV],[minU,maxV]]){for(let k=0;k<3;k++)positions.push(c[k]+(U[k]*(u-mu)+V[k]*(v-mv))*inflate);normals.push(...normal);uvs.push(u,v);}const cross=[U[1]*V[2]-U[2]*V[1],U[2]*V[0]-U[0]*V[2],U[0]*V[1]-U[1]*V[0]];if(cross.reduce((v,x,k)=>v+x*normal[k],0)<0)indices.push(first,first+2,first+1,first,first+3,first+2);else indices.push(first,first+1,first+2,first,first+2,first+3);
 }
 return {attrs:{POSITION:new Float32Array(positions),NORMAL:new Float32Array(normals),TEXCOORD_0:new Float32Array(uvs)},idx:new Uint32Array(indices),material:source.material};
 }
 const primitives=d.meshes[0].primitives.map(p=>{const attrs=Object.fromEntries(Object.entries(p.attributes).map(([k,v])=>[k,read(v)]));for(let i=0;i<attrs.POSITION.length;i++)attrs.POSITION[i]=attrs.POSITION[i]*scale-(i%3===1?.25:0);return {attrs,idx:new Uint32Array(read(p.indices)),material:p.material+materialOffset};});
 for(let lod=0;lod<3;lod++){
  const parts=[];for(const source of primitives){const leaf=out.materials[source.material].name.includes('leaves');const p=leaf?leafCards(source,lod):source;const pos=p.attrs.POSITION,trunk=out.materials[p.material].name.endsWith('trunk')||out.materials[p.material].name===name+':'+name;
   const target=leaf?[32000,16000,6500][lod]:trunk?[6500,2500,900][lod]:[6500,2500,800][lod];
   const uv=p.attrs.TEXCOORD_0,normal=p.attrs.NORMAL;const weights=new Float32Array(pos.length/3*5);for(let v=0;v<pos.length/3;v++){weights.set(normal.subarray(v*3,v*3+3),v*5);weights.set(uv.subarray(v*2,v*2+2),v*5+3);}
   const [indices,error]=leaf?[p.idx,0]:MeshoptSimplifier.simplifyWithAttributes(p.idx,pos,3,weights,5,[.05,.05,.05,.15,.15],null,target*3,leaf?.0009:1,['Permissive']);
   const used=new Map();for(const v of indices)if(!used.has(v))used.set(v,used.size);const idx=used.size<65536?new Uint16Array(indices.length):new Uint32Array(indices.length);for(let i=0;i<idx.length;i++)idx[i]=used.get(indices[i]);
   const attributes={};for(const [k,original]of Object.entries(p.attrs)){const n=k.startsWith('TEXCOORD')?2:3;const compact=k==='NORMAL'?new Int8Array(used.size*n):new Float32Array(used.size*n);for(const [old,i]of used)for(let c=0;c<n;c++)compact[i*n+c]=k==='NORMAL'?Math.round(Math.max(-1,Math.min(1,original[old*n+c]))*127):original[old*n+c];attributes[k]=accessor(compact,n===2?'VEC2':'VEC3',k==='NORMAL'?5120:5126,k==='NORMAL');}
   parts.push({attributes,indices:accessor(idx,'SCALAR',idx instanceof Uint16Array?5123:5125),material:p.material});report.push({name,lod,material:out.materials[p.material].name,triangles:indices.length/3,vertices:used.size,error});console.log(report.at(-1));
  }
  const mesh=out.meshes.push({name:name+'_LOD'+lod,primitives:parts})-1;const node=out.nodes.push({mesh,name:name+'_LOD'+lod,extras:{featherTreeVariant:variant,featherTreeLod:lod,featherTreeHeight:height}})-1;out.scenes[0].nodes.push(node);
 }
}
out.extensionsUsed=['KHR_texture_transform','KHR_mesh_quantization'];out.extensionsRequired=['KHR_mesh_quantization'];out.buffers=[{byteLength:size}];let json=Buffer.from(JSON.stringify(out));const pad=(4-json.length%4)%4;json=Buffer.concat([json,Buffer.alloc(pad,32)]);const data=Buffer.concat(bins);const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+data.length,8);const j=Buffer.alloc(8);j.writeUInt32LE(json.length);j.writeUInt32LE(0x4e4f534a,4);const b=Buffer.alloc(8);b.writeUInt32LE(data.length);b.writeUInt32LE(0x004e4942,4);fs.writeFileSync(output,Buffer.concat([header,j,json,b,data]));fs.writeFileSync(root+'/tree-report.json',JSON.stringify(report,null,2));console.log('GLB bytes',header.readUInt32LE(8));
