import type { WebGLRenderer } from 'three';
import { KTX2Loader } from 'three-stdlib';

/**
 * Compressed-asset DECODE config, shared by every `useGLTF` call site.
 *
 * The decoder/transcoder binaries are hosted locally under `public/decoders/` (NOT a CDN) so model
 * loading works offline and under the Tauri desktop CSP — the same reason the rest of the engine
 * bundles its own assets. This lets the editor load Draco-compressed geometry, meshopt geometry, and
 * KTX2 (KHR_texture_basisu) GPU-compressed textures — both our own compressed imports (see
 * `compressTextures.ts`) and the large ecosystem of already-compressed asset packs.
 */

/** drei sets the Draco decoder path when `useDraco` is a string — point it at our local copy. */
export const DRACO_DECODER_PATH = '/decoders/draco/';
const BASIS_TRANSCODER_PATH = '/decoders/basis/';

/**
 * One shared KTX2 transcoder for the whole app. Each KTX2Loader spins up a worker pool around the
 * basis transcoder .wasm, so creating one per model would multiply that cost — every `useGLTF` routes
 * through this single instance. `detectSupport(renderer)` MUST run once (with the live WebGLRenderer)
 * before the first KTX2 texture is parsed, or the loader throws; see `configureCompressedTextureSupport`.
 */
let ktx2Loader: KTX2Loader | null = null;
let supportDetected = false;

function getKTX2Loader(): KTX2Loader {
  if (!ktx2Loader) ktx2Loader = new KTX2Loader().setTranscoderPath(BASIS_TRANSCODER_PATH);
  return ktx2Loader;
}

/**
 * drei `useGLTF` `extendLoader` hook: attaches the shared KTX2 transcoder to the GLTFLoader so GLBs
 * using `KHR_texture_basisu` decode on the GPU. Pass as the 4th arg to `useGLTF`. A stable reference
 * so it doesn't churn drei's loader setup.
 */
export function extendGLTFLoader(loader: { setKTX2Loader: (loader: KTX2Loader) => unknown }): void {
  loader.setKTX2Loader(getKTX2Loader());
}

/**
 * Call once with the live renderer (from inside the Canvas) so the transcoder knows which compressed
 * format the GPU supports (ASTC / ETC / BC7 / …) and transcodes to it. Idempotent — safe to call on
 * every Canvas mount. Until this runs, KTX2 textures cannot be parsed; non-KTX2 models are unaffected.
 */
export function configureCompressedTextureSupport(renderer: WebGLRenderer): void {
  if (supportDetected) return;
  getKTX2Loader().detectSupport(renderer);
  supportDetected = true;
}
