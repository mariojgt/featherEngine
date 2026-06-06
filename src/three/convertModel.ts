import {
  BufferAttribute,
  ClampToEdgeWrapping,
  LoadingManager,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type BufferGeometry,
  type Color,
  type Material,
  type Mesh,
  type Object3D,
  type Texture,
  type Vector2,
} from 'three';

/**
 * Convert a dropped FBX file into a self-contained binary GLB, in the browser.
 *
 * The rest of the asset pipeline (storage in `assets/`, rendering via `useGLTF`, and the
 * export-to-data-URL bundling) only ever deals with glTF. Converting FBX on import keeps that
 * single-format invariant: we load the FBX with `FBXLoader`, re-export the scene as a binary GLB
 * with `GLTFExporter`, and hand back a `.glb` File as if the user had dropped one.
 *
 * Textures: FBX usually references *external* image files (a sibling .png). Pass those alongside
 * the .fbx in `siblings` and they're resolved from memory and embedded into the GLB. Any texture
 * that still can't be resolved is dropped (rather than failing the whole export), so the model
 * always imports — just untextured if its images are missing.
 */
const IMAGE_RE = /\.(png|jpe?g|webp|bmp|gif)$/i;

const TEXTURE_SLOTS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
  'specularMap',
] as const;

type TextureSlot = (typeof TEXTURE_SLOTS)[number];
type MaterialWithTextureSlots = Material & Partial<Record<TextureSlot, Texture | null>>;
type FbxSourceMaterial = MaterialWithTextureSlots & {
  color?: Color;
  emissive?: Color;
  emissiveIntensity?: number;
  shininess?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: Vector2;
  displacementScale?: number;
  isMeshBasicMaterial?: boolean;
  isMeshStandardMaterial?: boolean;
};

const COLOR_TEXTURE_SLOTS = new Set<string>(['map', 'emissiveMap', 'specularMap']);
const DATA_TEXTURE_SLOTS = new Set<string>([
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'lightMap',
]);

const basename = (path: string) => {
  const clean = path.split(/[?#]/, 1)[0] ?? path;
  const file = clean.split(/[\\/]/).pop() ?? clean;
  try {
    return decodeURIComponent(file).toLowerCase();
  } catch {
    return file.toLowerCase();
  }
};

/** A texture is usable only once its image has decoded to non-zero dimensions. */
function hasValidImage(texture: unknown): boolean {
  const img = (texture as { image?: { width?: number; naturalWidth?: number; height?: number; naturalHeight?: number } } | null)?.image;
  if (!img) return false;
  const w = img.width ?? img.naturalWidth ?? 0;
  const h = img.height ?? img.naturalHeight ?? 0;
  return w > 0 && h > 0;
}

/** Null out any material map whose image didn't load, so GLTFExporter won't choke on it. */
function stripUnresolvedTextures(root: Object3D): number {
  let dropped = 0;
  root.traverse((node) => {
    const mesh = node as { isMesh?: boolean; material?: unknown };
    if (!mesh.isMesh || !mesh.material) return;
    const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as Array<Record<string, unknown>>;
    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) {
        if (material[slot] && !hasValidImage(material[slot])) {
          material[slot] = null;
          material.needsUpdate = true;
          dropped += 1;
        }
      }
    }
  });
  return dropped;
}

const textureChannel = (texture: Texture | null | undefined) =>
  typeof texture?.channel === 'number' && Number.isFinite(texture.channel) ? texture.channel : 0;

const uvAttributeName = (channel: number) => (channel === 0 ? 'uv' : `uv${channel}`);

const hasUvChannel = (geometry: BufferGeometry, channel: number) => Boolean(geometry.getAttribute(uvAttributeName(channel)));

const setTextureChannel = (texture: Texture, channel: number) => {
  texture.channel = channel;
  texture.needsUpdate = true;
};

const maybeDuplicateUv = (geometry: BufferGeometry, targetChannel: number) => {
  if (targetChannel <= 0 || hasUvChannel(geometry, targetChannel)) return;
  const uv = geometry.getAttribute('uv');
  if (!uv) return;
  geometry.setAttribute(uvAttributeName(targetChannel), new BufferAttribute(uv.array.slice(0), uv.itemSize, uv.normalized));
};

const phongShininessToRoughness = (shininess: number | undefined) => {
  if (typeof shininess !== 'number' || !Number.isFinite(shininess)) return 0.65;
  return Math.min(1, Math.max(0.08, Math.sqrt(2 / (Math.max(0, shininess) + 2))));
};

function convertFbxMaterialToStandard(material: MaterialWithTextureSlots): MaterialWithTextureSlots {
  const source = material as FbxSourceMaterial;
  if (source.isMeshStandardMaterial || source.isMeshBasicMaterial) return material;

  const standard = new MeshStandardMaterial({
    name: source.name,
    color: source.color?.clone(),
    map: source.map ?? null,
    normalMap: source.normalMap ?? null,
    roughnessMap: source.roughnessMap ?? null,
    metalnessMap: source.metalnessMap ?? null,
    emissive: source.emissive?.clone(),
    emissiveMap: source.emissiveMap ?? null,
    emissiveIntensity: source.emissiveIntensity ?? 1,
    aoMap: source.aoMap ?? null,
    alphaMap: source.alphaMap ?? null,
    displacementMap: source.displacementMap ?? null,
    displacementScale: source.displacementScale ?? 1,
    lightMap: source.lightMap ?? null,
    opacity: source.opacity,
    transparent: source.transparent,
    alphaTest: source.alphaTest,
    side: source.side,
    roughness: source.roughness ?? phongShininessToRoughness(source.shininess),
    metalness: source.metalness ?? 0,
    vertexColors: source.vertexColors,
  });
  standard.userData = { ...source.userData, fbxOriginalMaterialType: source.type };
  if (source.normalScale) standard.normalScale.copy(source.normalScale);
  return standard as MaterialWithTextureSlots;
}

/**
 * FBXLoader gives us a live three.js scene, then GLTFExporter serializes it. This bridge makes
 * that transient scene glTF-safe before export: texture transforms are flushed, impossible UV
 * channels are remapped to UV0, and AO/light maps get a secondary UV fallback when the FBX only
 * provides one UV set. That prevents the common "textures slide/stretch after FBX import" failure.
 */
function prepareFbxForGltfExport(root: Object3D) {
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh || !mesh.material || !mesh.geometry) return;
    const geometry = mesh.geometry;
    const originalMaterials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MaterialWithTextureSlots[];
    const materials = originalMaterials.map(convertFbxMaterialToStandard);
    mesh.material = Array.isArray(mesh.material) ? materials : materials[0];

    for (const material of materials) {
      for (const slot of TEXTURE_SLOTS) {
        const texture = material[slot];
        if (!texture) continue;

        const currentChannel = textureChannel(texture);
        if (!hasUvChannel(geometry, currentChannel)) {
          setTextureChannel(texture, 0);
        }

        // three.js/glTF expect occlusion/light textures to be able to use a secondary UV set. Many
        // FBX files only carry one UV set; duplicating it preserves the same alignment instead of
        // leaving the exporter/loader to sample an absent channel.
        if ((slot === 'aoMap' || slot === 'lightMap') && hasUvChannel(geometry, 0) && !hasUvChannel(geometry, 1)) {
          maybeDuplicateUv(geometry, 1);
          setTextureChannel(texture, 1);
        }

        if ((texture.repeat.x !== 1 || texture.repeat.y !== 1 || texture.offset.x !== 0 || texture.offset.y !== 0) && texture.wrapS === ClampToEdgeWrapping && texture.wrapT === ClampToEdgeWrapping) {
          texture.wrapS = RepeatWrapping;
          texture.wrapT = RepeatWrapping;
        }
        if (COLOR_TEXTURE_SLOTS.has(slot)) texture.colorSpace = SRGBColorSpace;
        if (DATA_TEXTURE_SLOTS.has(slot)) texture.colorSpace = NoColorSpace;
        texture.updateMatrix();
        texture.needsUpdate = true;
      }
      material.needsUpdate = true;
    }
  });
}

export interface FbxConversion {
  file: File;
  /** Maps that couldn't be resolved and were dropped (model imported untextured for those). */
  droppedTextures: number;
}

export async function fbxToGlb(file: File, siblings: File[] = []): Promise<FbxConversion> {
  // Loaded lazily so the FBX/glTF toolchain stays out of the main bundle until it's needed.
  const { FBXLoader, GLTFExporter } = await import('three-stdlib');

  // Make sibling image files resolvable by basename, so FBX texture references find them.
  const imageUrls = new Map<string, string>();
  for (const sibling of siblings) {
    if (IMAGE_RE.test(sibling.name)) imageUrls.set(basename(sibling.name), URL.createObjectURL(sibling));
  }

  const manager = new LoadingManager();
  manager.setURLModifier((url) => imageUrls.get(basename(url)) ?? url);

  // FBXLoader queues its texture loads synchronously during parse(); track whether any started so
  // we only wait when there's actually something to load.
  let queued = false;
  manager.onStart = () => {
    queued = true;
  };
  const allSettled = new Promise<void>((resolve) => {
    manager.onLoad = () => resolve();
  });

  try {
    const buffer = await file.arrayBuffer();
    const group = new FBXLoader(manager).parse(buffer, '') as unknown as Object3D;

    if (queued) await allSettled; // let textures finish decoding (or error out) before exporting

    const droppedTextures = stripUnresolvedTextures(group);
    prepareFbxForGltfExport(group);
    const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;

    return {
      file: new File([glb], file.name.replace(/\.fbx$/i, '.glb'), { type: 'model/gltf-binary' }),
      droppedTextures,
    };
  } finally {
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  }
}
