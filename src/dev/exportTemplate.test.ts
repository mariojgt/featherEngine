// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { buildPackage, type PackageContent } from '../project/package';
import { readPackageFile, writePackageArchive } from '../project/packageArchive';
import { sha256Hex } from '../utils/contentHash';
import type { AssetItem } from '../types';

// Exercise the actual exporter with isolated stores, without loading the editor or unrelated
// imperative template builders (Verdant is supplied by the separate template workstream).
const compiled = ts.transpileModule(readFileSync(new URL('./exportTemplate.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const bytes = new Uint8Array([1, 4, 8, 16]);
const data = `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`;
const content: PackageContent = {
  prefabs: [], blueprints: [], graphs: [], materials: [], particleSystems: [], skeletons: [],
  skeletalMeshes: [], animations: [], animatorControllers: [], dataAssets: [], uiDocuments: [], variables: [], scenes: [],
};
const asset: AssetItem = { id: 'tree', name: 'tree.glb', type: 'model', size: 4, createdAt: 0, data };

function exporter(options: { assets?: AssetItem[]; ids?: string[]; build?: () => Promise<void>; fetch?: typeof fetch } = {}) {
  const exports = {} as typeof import('./exportTemplate');
  const dataset: Record<string, string> = {};
  const modules: Record<string, unknown> = {
    '../store/projectStore': { useProjectStore: { getState: () => ({ newProject: async () => {} }) } },
    '../store/editorStore': { useEditorStore: { getState: () => ({
      assets: options.assets ?? [asset],
      buildProjectPackage: () => ({ content, assetIds: options.ids ?? [asset.id] }),
    }) } },
    '../project/package': { buildPackage },
    '../project/packageArchive': { writePackageArchive },
    '../utils/contentHash': { sha256Hex },
    '../project/verdantTemplate': { createVerdantTemplate: options.build ?? (async () => {}) },
  };
  const context = {
    exports, require: (id: string) => {
      if (!(id in modules)) throw new Error(`Unexpected module ${id}`);
      return modules[id];
    },
    fetch: options.fetch ?? fetch, Uint8Array, URL, Request,
    console: { info: vi.fn(), error: vi.fn() },
    location: new URL('http://localhost:17420'),
    document: { baseURI: 'http://localhost:17420/', body: { dataset } },
  };
  runInNewContext(compiled, Object.assign(context, { window: context }));
  return { ...exports, dataset, context };
}

describe('standalone template asset export', () => {
  it('embeds data-only biome bytes without requiring source metadata', async () => {
    const entry = await exporter().toPackagedAsset(asset, new Map());
    expect(entry.bytes).toEqual(bytes);
    expect(entry.asset.hash).toBe(await sha256Hex(bytes));
    expect(entry.asset.source).toBeUndefined();
    const pkg = buildPackage('project', content, [entry.asset], { id: 'pkg-woodland', name: 'Woodland', version: '1.0.0' });
    const read = readPackageFile(writePackageArchive(pkg, new Map([[asset.id, entry.bytes]])));
    expect(read.bytes.get(asset.id)).toEqual(bytes);
    expect(read.pkg.assets[0].url).toBeUndefined();
  });

  it('prefers the live URL and retains recovered binary provenance', async () => {
    const hash = await sha256Hex(bytes);
    const entry = await exporter().toPackagedAsset({ ...asset, url: data, data: 'invalid' }, new Map([[hash, 'src/terrain/models/tree.glb']]));
    expect(entry.asset.source).toEqual({ url: 'src/terrain/models/tree.glb', sha256: hash, bytes: 4 });
    expect(entry.bytes).toEqual(bytes);
  });

  it('fails explicitly for missing bytes and HTTP failures', async () => {
    await expect(exporter().toPackagedAsset({ ...asset, data: undefined }, new Map())).rejects.toThrow('missing bytes');
    const failed = exporter({ fetch: vi.fn(async () => new Response('missing', { status: 404 })) });
    await expect(failed.toPackagedAsset(asset, new Map())).rejects.toThrow('HTTP 404');
  });

  it('fails the export when the dependency closure names an absent asset', async () => {
    const tool = exporter({ assets: [], ids: ['missing-tree'] });
    tool.runTemplateExport('verdant');
    await vi.waitFor(() => expect(tool.dataset.templateExportError).toContain('missing referenced asset missing-tree'));
    expect(tool.dataset.templateExport).toBeUndefined();
  });

  it('waits for captured source hashes and writes all dependency bytes into the Verdant archive', async () => {
    let archive: Uint8Array | undefined;
    const fakeFetch = vi.fn<typeof fetch>(async (input, init) => {
      if (String(input).startsWith('/__feather/export-template')) {
        expect(String(input)).toContain('slug=template-verdant');
        archive = init!.body as Uint8Array;
        return new Response('ok');
      }
      return new Response(bytes);
    });
    const tool = exporter({ fetch: fakeFetch, build: async () => {
      await tool.context.fetch('/src/terrain/models/tree.glb?url');
    } });
    tool.runTemplateExport('verdant');
    await vi.waitFor(() => {
      expect(tool.dataset.templateExportError).toBeUndefined();
      expect(tool.dataset.templateExport).toBeDefined();
    });
    const read = readPackageFile(archive!);
    expect(read.pkg.meta.name).toBe('Verdant — A Woodland Study');
    expect(read.pkg.assets[0].source?.url).toBe('src/terrain/models/tree.glb?url');
    expect(read.bytes.get(asset.id)).toEqual(bytes);
    expect(tool.context.fetch).toBe(fakeFetch);
  });
});
