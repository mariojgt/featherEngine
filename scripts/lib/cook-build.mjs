import { createServer } from 'vite';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

/** The CLI and installed editor call the same asset cooker, with storage/texture decoding supplied
 * by their host. Cache files are content-addressed and replaced atomically. */
export async function cookBuildVariants(root, bundle, targets) {
  const server = await createServer({ root, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  try {
    const { cookGameAssets, externalizeGameAssets } = await server.ssrLoadModule('/src/project/cookAssets.ts');
    const { compressGlbTextures } = await server.ssrLoadModule('/src/three/compressTextures.ts');
    const directory = resolve(root, '.feather-cache/assets'); await mkdir(directory, { recursive: true });
    const cache = {
      async get(key) {
        try { const value = JSON.parse(await readFile(resolve(directory, `${key}.json`), 'utf8')); return { ...value, bytes: new Uint8Array(Buffer.from(value.bytes, 'base64')) }; } catch { return null; }
      },
      async put(key, value) {
        const path = resolve(directory, `${key}.json`), temp = `${path}.${process.pid}.tmp`;
        await writeFile(temp, JSON.stringify({ ...value, bytes: Buffer.from(value.bytes).toString('base64') })); await rename(temp, path);
      },
    };
    const variants = new Map();
    for (const target of targets) {
      const cooked = await cookGameAssets(bundle, target, {
        cache, backend: 'node-v1', onProgress: (line) => console.log(line),
        textures: async (bytes, preset) => {
          const max = { desktop: 4096, web: 2048, mobile: 1024 }[preset];
          return (await compressGlbTextures(bytes.slice().buffer, { throwOnFailure: true, imageDecoder: async (source) => {
            const { data, info } = await sharp(source).resize(max, max, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
            return { data: new Uint8Array(data), width: info.width, height: info.height };
          } })).data;
        },
      });
      variants.set(target, { ...externalizeGameAssets(cooked.bundle), report: cooked.report });
    }
    return variants;
  } finally { await server.close(); }
}
