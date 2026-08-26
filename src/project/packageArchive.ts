import { unzipSync, zipSync, type Zippable } from 'fflate';
import { parsePackage, type NodeForgePackage } from './package';
import type { AssetItem } from '../types';

/**
 * The `.nfpack` container: one compressed file holding the manifest AND every asset's bytes.
 *
 * Publishing is a single artifact to upload, and installing is a single download rather than a
 * manifest plus N asset fetches. Deflate also does the heavy lifting on size — the third-person
 * world's 22 MB character is mostly animation floats and JSON, which compress ~3x.
 *
 * Layout:
 *   package.json          the NodeForgePackage manifest (assets listed WITHOUT their bytes)
 *   assets/<sha256><ext>  raw asset bytes, content-addressed
 *
 * Content addressing means an asset referenced under two ids is stored once, and the entry name is
 * verifiable: a reader can re-hash the bytes and compare against the manifest.
 *
 * Older `.nfpack` files are plain JSON. Readers sniff the first bytes, so both still open — a v1
 * file a user exported months ago must not stop working because the container changed.
 */

const MANIFEST_ENTRY = 'package.json';
const ASSET_DIR = 'assets/';

/** ZIP local-file-header magic: "PK\x03\x04". */
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

/** True when these bytes are a zip container rather than a legacy JSON package. */
export function isPackageArchive(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && ZIP_MAGIC.every((byte, index) => bytes[index] === byte);
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
};

/** Archive entry name for an asset, derived from its content hash so identical bytes collapse. */
export const assetEntryName = (asset: AssetItem, hash: string) => `${ASSET_DIR}${hash}${extensionOf(asset.name)}`;

export interface PackageArchive {
  pkg: NodeForgePackage;
  /** Asset bytes keyed by the id used in `pkg.assets`. Absent for assets the archive doesn't carry. */
  bytes: Map<string, Uint8Array>;
}

export interface PackageArchiveWriteOptions {
  /** Optional fixed ZIP timestamp for reproducible catalog/build artifacts. */
  mtime?: Date;
}

/**
 * Build the container. `bytes` supplies each asset's raw data keyed by asset id; assets without an
 * entry are written manifest-only (they keep whatever `source` they already carry and are fetched
 * at install time instead).
 */
export function writePackageArchive(
  pkg: NodeForgePackage,
  bytes: Map<string, Uint8Array>,
  options: PackageArchiveWriteOptions = {},
): Uint8Array {
  const files: Zippable = {};
  const manifestAssets: AssetItem[] = [];

  for (const asset of pkg.assets) {
    const data = bytes.get(asset.id);
    if (!data || !asset.hash) {
      // Nothing archived for this asset, so keep whatever it already carried — an inline `data`
      // URL or an external `source`. Dropping `data` here would silently discard the only copy.
      manifestAssets.push({ ...asset, url: undefined });
      continue;
    }
    const entry = assetEntryName(asset, asset.hash);
    // Two ids sharing a hash write the same entry — the second is a no-op, not a duplicate.
    // Already-compressed payloads (mp3, png, ktx2) are STORED: deflating them costs time and
    // typically makes them marginally bigger.
    files[entry] = shouldDeflate(entry) ? data : [data, { level: 0 }];
    manifestAssets.push({ ...asset, data: undefined, url: undefined, size: data.byteLength });
  }

  const manifest = { ...pkg, assets: manifestAssets };
  files[MANIFEST_ENTRY] = new TextEncoder().encode(JSON.stringify(manifest));

  // Level 6: above it the size difference is marginal on this content and it costs real time on a
  // 22 MB asset.
  return zipSync(files, { level: 6, ...(options.mtime ? { mtime: options.mtime } : {}) });
}

const STORED_EXTENSIONS = new Set(['.mp3', '.ogg', '.png', '.jpg', '.jpeg', '.webp', '.ktx2']);

/** Whether an entry is worth deflating — precompressed formats only get bigger. */
export const shouldDeflate = (entryName: string) => !STORED_EXTENSIONS.has(extensionOf(entryName));

/** Read a container back into its manifest plus asset bytes. Throws a readable error on bad input. */
export function readPackageArchive(archive: Uint8Array): PackageArchive {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(archive);
  } catch {
    throw new Error('That file is not a readable package archive.');
  }

  const manifestBytes = files[MANIFEST_ENTRY];
  if (!manifestBytes) throw new Error('Package archive is missing its manifest.');

  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error('Package archive has a corrupt manifest.');
  }
  const pkg = parsePackage(raw);

  const bytes = new Map<string, Uint8Array>();
  for (const asset of pkg.assets) {
    if (!asset.hash) continue;
    const data = files[assetEntryName(asset, asset.hash)];
    if (data) bytes.set(asset.id, data);
  }
  return { pkg, bytes };
}

/**
 * Accept either container: a zip archive or a legacy plain-JSON `.nfpack`. Callers hand us whatever
 * came off disk or the network and get back a uniform result.
 */
export function readPackageFile(input: Uint8Array): PackageArchive {
  if (isPackageArchive(input)) return readPackageArchive(input);
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(input));
  } catch {
    throw new Error('That file is not a NodeForge package (.nfpack).');
  }
  return { pkg: parsePackage(raw), bytes: new Map() };
}
