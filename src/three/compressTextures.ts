import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { encodeToKTX2 } from 'ktx2-encoder';

/**
 * Encode-on-import: transcode a GLB's embedded PNG/JPG/WebP textures to GPU-native KTX2
 * (`KHR_texture_basisu`) and return a new GLB. The browser decodes ordinary textures to uncompressed
 * RGBA on the GPU (a 2K map ≈ 22 MB of VRAM); KTX2 stays compressed on the GPU, cutting VRAM ~6–8×
 * and shrinking the download. This is the single biggest runtime-memory + load-time win for the
 * browser-shipped games this engine produces.
 *
 * We drive the web-only `encodeToKTX2` + the `@gltf-transform` extension API directly rather than the
 * package's `ktx2-encoder/gltf-transform` helper, because that helper dynamically imports BOTH its web
 * and Node encoders — and the Node branch (top-level await + `createRequire`) breaks the browser build.
 *
 * The Basis encoder .wasm/.js are hosted locally (`public/decoders/basis/`) so encoding works offline
 * and under the Tauri CSP (the package default points at a CDN). The web encoder decodes source images
 * via OffscreenCanvas + WebGL2 internally, so this only runs in a browser/editor context.
 *
 * Callers MUST treat a throw (or an all-skipped result) as "keep the original bytes" so a bad encode
 * never blocks an import.
 */

const ENCODER_JS_URL = '/decoders/basis/basis_encoder.js';
const ENCODER_WASM_URL = '/decoders/basis/basis_encoder.wasm';

/** Source image types the Basis encoder can ingest (everything else is left untouched). */
const SUPPORTED_MIME = ['image/png', 'image/jpeg', 'image/webp'];

export interface CompressionResult {
  /** The re-serialized GLB (KTX2 textures) — or the original bytes when there was nothing to compress. */
  data: Uint8Array;
  beforeBytes: number;
  afterBytes: number;
  /** How many textures the source GLB had (0 ⇒ untouched). */
  textureCount: number;
  /** True when at least one texture was actually transcoded to KTX2. */
  compressed: boolean;
}

export async function compressGlbTextures(input: ArrayBuffer): Promise<CompressionResult> {
  const beforeBytes = input.byteLength;
  const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.readBinary(new Uint8Array(input));
  const root = doc.getRoot();
  const textures = root.listTextures();
  if (textures.length === 0) {
    return { data: new Uint8Array(input), beforeBytes, afterBytes: beforeBytes, textureCount: 0, compressed: false };
  }

  // Classify by material slot: color maps (sRGB) compress well as small ETC1S; data maps
  // (normal/metalRough/occlusion, linear) keep more detail as UASTC.
  const colorTextures = new Set(
    root.listMaterials().flatMap((mat) => [mat.getBaseColorTexture(), mat.getEmissiveTexture()].filter(Boolean)),
  );

  const common = { generateMipmap: true, jsUrl: ENCODER_JS_URL, wasmUrl: ENCODER_WASM_URL };
  let compressed = false;
  for (const texture of textures) {
    const mime = texture.getMimeType();
    if (mime === 'image/ktx2' || !SUPPORTED_MIME.includes(mime)) continue;
    const image = texture.getImage();
    if (!image) continue;
    try {
      const isColor = colorTextures.has(texture);
      const ktx2 = await encodeToKTX2(
        image,
        isColor
          ? { ...common, isUASTC: false, isPerceptual: true, isSetKTX2SRGBTransferFunc: true }
          : { ...common, isUASTC: true, isPerceptual: false },
      );
      texture.setImage(ktx2).setMimeType('image/ktx2');
      compressed = true;
    } catch (error) {
      // One bad texture shouldn't fail the whole model — leave it as-is and keep going.
      console.warn(`KTX2 encode failed for texture "${texture.getName() || texture.getURI()}":`, error);
    }
  }

  if (!compressed) {
    return { data: new Uint8Array(input), beforeBytes, afterBytes: beforeBytes, textureCount: textures.length, compressed: false };
  }
  // Declare the extension so the writer emits KHR_texture_basisu; required because the textures are
  // now KTX2-only (a loader without the extension can't read them).
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  const data = await io.writeBinary(doc);
  return { data, beforeBytes, afterBytes: data.byteLength, textureCount: textures.length, compressed: true };
}
