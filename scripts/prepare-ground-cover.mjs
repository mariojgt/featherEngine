/** Prepare the pinned CC0 woodland understorey. Run from the repository root. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(path.join(process.cwd(), 'package.json'));
const sharp = require('sharp');
const { MeshoptSimplifier } = require('meshoptimizer');
await MeshoptSimplifier.ready;
const root = path.resolve(process.argv[2] ?? '/tmp/feather-ground-cover-sources');
const output = path.resolve(process.argv[3] ?? 'src/terrain/models/woodland-ground-cover.glb');
const manifestPath = 'src/terrain/models/ground-cover-provenance.json';
const names = ['fern_02', 'rock_moss_set_01', 'tree_stump_01'];
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath)) : { license: 'CC0-1.0', sources: [] };
async function download(name, file) {
 const basename=path.basename(new URL(file.url).pathname);
 const relative=basename.endsWith('.gltf')?name+'.gltf':basename.endsWith('.bin')?basename:'textures/'+basename;
 const dest=path.join(root,name,relative); let bytes=fs.existsSync(dest)?fs.readFileSync(dest):null;
 if (!bytes || crypto.createHash('md5').update(bytes).digest('hex')!==file.md5) {
  const r=await fetch(file.url,{headers:{'User-Agent':'FeatherEngine-AssetPreparation/1.0'}});if(!r.ok)throw new Error('Download failed '+file.url);
  bytes=Buffer.from(await r.arrayBuffer());if(crypto.createHash('md5').update(bytes).digest('hex')!==file.md5)throw new Error('Checksum changed '+file.url);
  fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,bytes);
 }
}
if (!manifest.sources.length) for (const name of names) {
 const meta=JSON.parse(fs.readFileSync(path.join(root,name+'.json'))), g=meta.gltf['1k'].gltf;
 const files=[{url:g.url,md5:g.md5},...Object.values(g.include).map(f=>({url:f.url,md5:f.md5}))];
 if(name==='fern_02')files.push(meta.Alpha['1k'].png);
 if(name==='rock_moss_set_01')files.push(meta.arm['1k'].jpg);
 manifest.sources.push({asset:name,url:'https://polyhaven.com/a/'+name,authors:name==='fern_02'?['Rico Cilliers','Rob Tuytel']:name==='rock_moss_set_01'?['Kless Gyzen']:['Rob Tuytel'],files:files.map(({url,md5})=>({url,md5}))});
}
for(const s of manifest.sources)await Promise.all(s.files.map(f=>download(s.asset,f)));
const out={asset:{version:'2.0',generator:'Feather woodland understorey preparation'},scene:0,scenes:[{nodes:[],extras:{featherTreeLibrary:true,featherGroundCoverLibrary:true}}],nodes:[],meshes:[],materials:[],textures:[],images:[],samplers:[{magFilter:9729,minFilter:9987,wrapS:10497,wrapT:10497}],buffers:[],bufferViews:[],accessors:[]};
let size=0;const bins=[],report=[];
function blob(bytes){const b=Buffer.from(bytes.buffer??bytes,bytes.byteOffset??0,bytes.byteLength??bytes.length);const v=out.bufferViews.push({buffer:0,byteOffset:size,byteLength:b.length})-1;bins.push(b);size+=b.length;const padding=(4-size%4)%4;if(padding){bins.push(Buffer.alloc(padding));size+=padding;}return v;}
function accessor(array,type,componentType,normalized=false){const n={SCALAR:1,VEC2:2,VEC3:3}[type],a={bufferView:blob(array),componentType,count:array.length/n,type};if(normalized)a.normalized=true;if(type==='VEC3'&&componentType===5126){a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<array.length;i++){a.min[i%3]=Math.min(a.min[i%3],array[i]);a.max[i%3]=Math.max(a.max[i%3],array[i]);}}return out.accessors.push(a)-1;}
for(const [kindIndex,name]of names.entries()){
 const kind=['fern','rock','wood'][kindIndex],dir=path.join(root,name),d=JSON.parse(fs.readFileSync(dir+'/'+name+'.gltf')),bin=fs.readFileSync(dir+'/'+name+'.bin');
 function read(i){const a=d.accessors[i],v=d.bufferViews[a.bufferView],n={SCALAR:1,VEC2:2,VEC3:3}[a.type],T={5126:Float32Array,5125:Uint32Array,5123:Uint16Array}[a.componentType],s=T.BYTES_PER_ELEMENT,arr=new T(a.count*n);for(let j=0;j<a.count;j++)for(let k=0;k<n;k++){const p=(v.byteOffset??0)+(a.byteOffset??0)+j*(v.byteStride??s*n)+k*s;arr[j*n+k]=a.componentType===5126?bin.readFloatLE(p):a.componentType===5125?bin.readUInt32LE(p):bin.readUInt16LE(p);}return arr;}
 const m=structuredClone(d.materials[0]);m.name=name+(kind==='fern'?':leaves':'');m.doubleSided=kind==='fern';m.pbrMetallicRoughness.metallicFactor=0;if(kind==='fern')m.alphaCutoff=.42;
 async function texture(info,type){const img=d.images[d.textures[info.index].source],target=type==='albedo'?1024:512;let source=dir+'/'+img.uri;if(kind==='rock'&&type==='arm')source=dir+'/textures/'+name+'_arm_1k.jpg';let image=sharp(source).resize(target,target,{fit:'fill'});const alpha=kind==='fern'&&type==='albedo';if(alpha){const rgb=await image.removeAlpha().raw().toBuffer(),a=await sharp(dir+'/textures/'+name+'_alpha_1k.png').resize(target,target).greyscale().raw().toBuffer();image=sharp(rgb,{raw:{width:target,height:target,channels:3}}).joinChannel(a,{raw:{width:target,height:target,channels:1}});}const bytes=await(alpha?image.png({compressionLevel:9}):image.jpeg({quality:type==='normal'?95:90,chromaSubsampling:'4:4:4'})).toBuffer();const imageIndex=out.images.push({bufferView:blob(bytes),mimeType:alpha?'image/png':'image/jpeg',name:name+' '+type})-1;info.index=out.textures.push({sampler:0,source:imageIndex})-1;}
 await texture(m.pbrMetallicRoughness.baseColorTexture,'albedo');await texture(m.normalTexture,'normal');await texture(m.pbrMetallicRoughness.metallicRoughnessTexture,'arm');m.occlusionTexture={...m.pbrMetallicRoughness.metallicRoughnessTexture,strength:kind==='fern'?.45:.85};const material=out.materials.push(m)-1;
 // Individual source meshes are rooted around their local origin; discard the display-layout nodes.
 for(let variant=0;variant<d.meshes.length;variant++){
  const p=d.meshes[variant].primitives[0],attrs=Object.fromEntries(['POSITION','NORMAL','TEXCOORD_0'].map(k=>[k,read(p.attributes[k])])),idx=new Uint32Array(read(p.indices));
  const factor=kind==='rock'?.5:kind==='fern'?1.6:1;for(let i=0;i<attrs.POSITION.length;i++)attrs.POSITION[i]*=factor;
  const height=Math.max(.3,...Array.from(attrs.POSITION).filter((_,i)=>i%3===1));
  const weights=new Float32Array(attrs.POSITION.length/3*5);for(let i=0;i<attrs.POSITION.length/3;i++){weights.set(attrs.NORMAL.subarray(i*3,i*3+3),i*5);weights.set(attrs.TEXCOORD_0.subarray(i*2,i*2+2),i*5+3);}
  for(let lod=0;lod<3;lod++){
   const target=kind==='fern'?[2600,900,250][lod]:kind==='rock'?[1800,650,180][lod]:[3000,1000,300][lod];
   const [indices,error]=MeshoptSimplifier.simplifyWithAttributes(idx,attrs.POSITION,3,weights,5,[.08,.08,.08,.3,.3],null,Math.min(idx.length,target*3),kind==='fern'?[0,.003,.015][lod]:1,['Permissive']);
   const used=new Map();for(const v of indices)if(!used.has(v))used.set(v,used.size);const compactIdx=new Uint16Array(indices.length);for(let i=0;i<indices.length;i++)compactIdx[i]=used.get(indices[i]);const attributes={};
   for(const[k,original]of Object.entries(attrs)){const n=k==='TEXCOORD_0'?2:3,compact=k==='NORMAL'?new Int8Array(used.size*n):new Float32Array(used.size*n);for(const[old,i]of used)for(let c=0;c<n;c++)compact[i*n+c]=k==='NORMAL'?Math.round(Math.max(-1,Math.min(1,original[old*n+c]))*127):original[old*n+c];attributes[k]=accessor(compact,n===2?'VEC2':'VEC3',k==='NORMAL'?5120:5126,k==='NORMAL');}
   const mesh=out.meshes.push({name:name+'_'+variant+'_LOD'+lod,primitives:[{attributes,indices:accessor(compactIdx,'SCALAR',5123),material}]})-1;
   const node=out.nodes.push({mesh,name:name+'_'+variant+'_LOD'+lod,extras:{featherGroundCoverKind:kind,featherTreeVariant:variant,featherTreeLod:lod,featherTreeHeight:height}})-1;out.scenes[0].nodes.push(node);report.push({kind,variant,lod,triangles:indices.length/3,error});
  }
 }
}
out.extensionsUsed=['KHR_mesh_quantization'];out.extensionsRequired=['KHR_mesh_quantization'];out.buffers=[{byteLength:size}];let json=Buffer.from(JSON.stringify(out));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const data=Buffer.concat(bins),header=Buffer.alloc(12),j=Buffer.alloc(8),b=Buffer.alloc(8);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+data.length,8);j.writeUInt32LE(json.length);j.writeUInt32LE(0x4e4f534a,4);b.writeUInt32LE(data.length);b.writeUInt32LE(0x004e4942,4);const glb=Buffer.concat([header,j,json,b,data]);fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,glb);manifest.output={file:path.basename(output),bytes:glb.length,sha256:crypto.createHash('sha256').update(glb).digest('hex')};fs.writeFileSync(root+'/ground-cover-provenance.json',JSON.stringify(manifest,null,2)+'\n');fs.writeFileSync(root+'/ground-cover-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({output:manifest.output,report}));
