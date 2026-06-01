import { LoadingManager, type Object3D } from 'three';

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

const basename = (path: string) => path.split(/[\\/]/).pop()?.toLowerCase() ?? '';

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
    if (IMAGE_RE.test(sibling.name)) imageUrls.set(sibling.name.toLowerCase(), URL.createObjectURL(sibling));
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
    const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;

    return {
      file: new File([glb], file.name.replace(/\.fbx$/i, '.glb'), { type: 'model/gltf-binary' }),
      droppedTextures,
    };
  } finally {
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
  }
}
