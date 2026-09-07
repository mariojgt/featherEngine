import { Box3, Color, Matrix4, PropertyBinding, Quaternion, Vector3 } from 'three';
import { readModelDocument, animationTimeMaximum } from './modelDocument';

export interface ModelInspection {
  skeleton?: { boneNames: string[]; rootBone: string; signature: string };
  clips: { name: string; duration: number }[];
  materials: { name: string; color: string; metalness: number; roughness: number; emissiveColor: string; emissiveIntensity: number; hasBaseColorMap: boolean; hasNormalMap: boolean }[];
  stats?: { triangles: number; meshes: number; textures: number; dimensions: [number, number, number]; sourceBytes: number; copyright?: string };
  warnings?: string[];
}

function signatureOf(boneNames: string[]): string {
  let hash = 0x811c9dc5;
  const text = boneNames.join('|');
  for (let index = 0; index < text.length; index++) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
const rgb = (value: number[] = [0, 0, 0]) => `#${new Color().setRGB(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0).getHexString()}`;

/**
 * glTF stores materials, joints, accessor bounds and clip time ranges in its JSON document, even
 * when geometry/texture bytes are compressed. Reading that metadata makes import independent of
 * renderer initialization and Draco/KTX2 workers. The normal rendering loader still decodes assets.
 */
export async function inspectModel(file: File): Promise<ModelInspection> {
  const source = await file.arrayBuffer();
  const doc = readModelDocument(source);
  const nodes = doc.nodes ?? [];
  const warnings: string[] = [];
  const materialIds = new Set<number>();
  const bounds = new Box3();
  let triangles = 0, meshes = 0;
  let skinIndex: number | undefined;
  const visited = new Set<number>();
  const visit = (index: number, parent: Matrix4) => {
    if (visited.has(index)) return;
    visited.add(index);
    const node = nodes[index];
    if (!node) throw new Error(`Model references missing node ${index}.`);
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3().fromArray(node.translation ?? [0, 0, 0]), new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]), new Vector3().fromArray(node.scale ?? [1, 1, 1]));
    const world = parent.clone().multiply(local);
    if (node.skin !== undefined && skinIndex === undefined) skinIndex = node.skin;
    if (node.mesh !== undefined) {
      const mesh = doc.meshes?.[node.mesh];
      if (!mesh) throw new Error(`Model references missing mesh ${node.mesh}.`);
      meshes++;
      for (const primitive of mesh.primitives) {
        if (primitive.material !== undefined) materialIds.add(primitive.material);
        else materialIds.add(-1);
        const position = doc.accessors?.[primitive.attributes?.POSITION ?? -1];
        const count = doc.accessors?.[primitive.indices ?? -1]?.count ?? position?.count ?? 0;
        const mode = primitive.mode ?? 4;
        triangles += mode === 4 ? Math.floor(count / 3) : mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
        if (position?.min?.length === 3 && position.max?.length === 3) bounds.union(new Box3(new Vector3().fromArray(position.min), new Vector3().fromArray(position.max)).applyMatrix4(world));
        else warnings.push('Some geometry has no bounds metadata; dimensions may be incomplete.');
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const children = new Set(nodes.flatMap((node) => node.children ?? []));
  const roots = doc.scenes?.[doc.scene ?? 0]?.nodes ?? nodes.flatMap((_, index) => children.has(index) ? [] : [index]);
  for (const root of roots) visit(root, new Matrix4());
  const materials = [...materialIds].map((index) => {
    const material = index === -1 ? undefined : doc.materials?.[index];
    if (index !== -1 && !material) throw new Error(`Model references missing material ${index}.`);
    const pbr = material?.pbrMetallicRoughness;
    return { name: material?.name ?? (index === -1 ? 'Default Material' : `Imported Material ${index + 1}`), color: rgb(pbr?.baseColorFactor ?? [1, 1, 1]), metalness: pbr?.metallicFactor ?? 1, roughness: pbr?.roughnessFactor ?? 1, emissiveColor: rgb(material?.emissiveFactor), emissiveIntensity: material?.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1, hasBaseColorMap: Boolean(pbr?.baseColorTexture), hasNormalMap: Boolean(material?.normalTexture) };
  });
  let skeleton: ModelInspection['skeleton'];
  const skin = doc.skins?.[skinIndex ?? -1];
  if (skin?.joints.length) {
    const boneNames = skin.joints.map((index) => PropertyBinding.sanitizeNodeName(nodes[index]?.name ?? ''));
    const allNames = nodes.map((node) => PropertyBinding.sanitizeNodeName(node.name ?? ''));
    if (boneNames.some((name) => !name || allNames.filter((candidate) => candidate === name).length !== 1)) warnings.push('Unnamed or duplicate joints: give model nodes unique names before registering reusable animation assets. The imported model remains usable.');
    else skeleton = { boneNames, rootBone: boneNames[0], signature: signatureOf(boneNames) };
  }
  if ((doc.skins?.length ?? 0) > 1) warnings.push('Multiple rigs: reusable animation assets use the first visible rig. Split rigs into separate files for independent animation.');
  const clips = (doc.animations ?? []).flatMap((animation, index) => {
    const times = animation.samplers.map((sampler) => animationTimeMaximum(doc, source, sampler.input));
    if (!times.length || times.some((time) => time === undefined || !Number.isFinite(time))) { warnings.push(`Animation "${animation.name ?? index}" has incomplete time bounds. Re-export with animation accessor bounds before registering this clip.`); return []; }
    return [{ name: animation.name ?? `animation_${index}`, duration: Math.max(0, ...times as number[]) }];
  });
  const dimensions = bounds.isEmpty() ? [0, 0, 0] as [number, number, number] : bounds.getSize(new Vector3()).toArray() as [number, number, number];
  if (Math.max(...dimensions) > 100) warnings.push('This model is over 100 meters across. Check its source units before placing it.');
  if (triangles > 100_000) warnings.push('Over 100,000 triangles. Check LOD and target performance before using many copies.');
  for (const entry of [...(doc.buffers ?? []), ...(doc.images ?? [])]) if (entry.uri && !entry.uri.startsWith('data:')) warnings.push(`External resource "${entry.uri}" must be packed with the model before export.`);
  return { skeleton, clips, materials, stats: { triangles, meshes, textures: doc.textures?.length ?? 0, dimensions, sourceBytes: file.size, copyright: doc.asset.copyright }, warnings: [...new Set(warnings)] };
}
