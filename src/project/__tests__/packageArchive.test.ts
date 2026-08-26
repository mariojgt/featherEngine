import { describe, it, expect, afterEach, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { buildPackage, type NodeForgePackage } from '../package';
import { isPackageArchive, readPackageFile, writePackageArchive } from '../packageArchive';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { blankProject } from '../serialize';
import type { AssetItem } from '../../types';

/**
 * The `.nfpack` container: one compressed file carrying the manifest AND every asset.
 *
 * The properties that matter are that it round-trips exactly, that identical bytes are stored once,
 * that legacy plain-JSON packages still open, and — the whole point — that installing one needs no
 * network at all.
 */

const asset = (id: string, name: string, hash: string): AssetItem => ({
  id,
  name,
  type: 'model',
  size: 4,
  hash,
  createdAt: 0,
});

function pkgWith(assets: AssetItem[]): NodeForgePackage {
  return buildPackage(
    'asset',
    {
      prefabs: [],
      blueprints: [],
      graphs: [],
      materials: [],
      particleSystems: [],
      skeletons: [],
      skeletalMeshes: [],
      animations: [],
      animatorControllers: [],
      dataAssets: [],
      uiDocuments: [],
      variables: [],
    },
    assets,
    { id: 'pkg-archive', name: 'Archive Test', version: '1.0.0' },
  );
}

describe('.nfpack container', () => {
  it('round-trips the manifest and every asset byte', () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const pkg = pkgWith([asset('a1', 'model.glb', 'hash-one')]);

    const archive = writePackageArchive(pkg, new Map([['a1', bytes]]));
    expect(isPackageArchive(archive)).toBe(true);

    const read = readPackageFile(archive);
    expect(read.pkg.meta.name).toBe('Archive Test');
    expect(read.pkg.assets).toHaveLength(1);
    expect([...(read.bytes.get('a1') ?? [])]).toEqual([...bytes]);
    // The manifest must not also carry the bytes — that would defeat the container.
    expect(read.pkg.assets[0].data).toBeUndefined();
  });

  it('stores identical bytes once even when two assets reference them', () => {
    const bytes = new Uint8Array([9, 9, 9, 9]);
    const pkg = pkgWith([asset('a1', 'shared.glb', 'same-hash'), asset('a2', 'shared-copy.glb', 'same-hash')]);

    const archive = writePackageArchive(pkg, new Map([['a1', bytes], ['a2', bytes]]));

    // Content-addressed entry names collapse the duplicate: one payload, both ids resolving to it.
    const entries = Object.keys(unzipSync(archive)).filter((name) => name.startsWith('assets/'));
    expect(entries).toHaveLength(1);
    const read = readPackageFile(archive);
    expect([...(read.bytes.get('a1') ?? [])]).toEqual([...bytes]);
    expect([...(read.bytes.get('a2') ?? [])]).toEqual([...bytes]);
  });

  it('can pin ZIP metadata for byte-stable store builds', () => {
    const pkg = pkgWith([]);
    const mtime = new Date('2026-01-01T00:00:00.000Z');
    const first = writePackageArchive(pkg, new Map(), { mtime });
    const second = writePackageArchive(pkg, new Map(), { mtime });
    expect(first).toEqual(second);
  });

  it('still opens a legacy plain-JSON package', () => {
    // Packages exported before the container change are bare JSON. They must not stop working.
    const legacy = new TextEncoder().encode(JSON.stringify(pkgWith([])));
    expect(isPackageArchive(legacy)).toBe(false);
    const read = readPackageFile(legacy);
    expect(read.pkg.meta.name).toBe('Archive Test');
    expect(read.bytes.size).toBe(0);
  });

  it('keeps inline bytes for an asset it cannot archive', () => {
    // No hash means no content-addressed entry name, so the bytes stay where they were rather than
    // being dropped — losing the only copy would silently ship a broken package.
    const inline: AssetItem = { id: 'a1', name: 'x.png', type: 'image', size: 1, createdAt: 0, data: 'data:x,AAA' };
    const read = readPackageFile(writePackageArchive(pkgWith([inline]), new Map()));
    expect(read.pkg.assets[0].data).toBe('data:x,AAA');
  });

  it('rejects input that is neither an archive nor a package', () => {
    expect(() => readPackageFile(new TextEncoder().encode('not json at all'))).toThrow(/not a NodeForge package/i);
    expect(() => readPackageFile(new TextEncoder().encode('{"format":"something-else"}'))).toThrow();
  });
});

describe('installing from an archive', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses the bytes inside the file and never touches the network', async () => {
    useEditorStore.getState().loadProject(blankProject('Archive Install'));
    useProjectStore.getState().useDemo();

    // A real 1x1 PNG carried inside the container.
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', png))]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const pkg = pkgWith([{ ...asset('a1', 'brick.png', hash), type: 'image' }]);
    const archive = writePackageArchive(pkg, new Map([['a1', png]]));

    let assetFetches = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        assetFetches += 1;
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
        };
      }),
    );

    const ok = await useProjectStore.getState().importPackageFromUrl('store/archived.nfpack');
    expect(ok).toBe(true);

    // Exactly one request: the package itself. No per-asset downloads.
    expect(assetFetches).toBe(1);
    const installed = useEditorStore.getState().assets.find((entry) => entry.hash === hash);
    expect(installed).toBeDefined();
    expect(installed!.unresolved).toBeFalsy();
    // Labelled by extension, not left as octet-stream, or it would not render.
    expect(installed!.url).toMatch(/^data:image\/png;base64,/);
  });
});
