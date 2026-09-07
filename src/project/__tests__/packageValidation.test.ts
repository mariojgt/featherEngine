import { describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { buildPackage, parsePackage } from '../package';
import { readPackageFile, verifyPackageIntegrity, writePackageArchive } from '../packageArchive';
import { makeUIDocument, makeUIElement } from '../../store/editor/ui';
const empty = () => buildPackage('asset', { prefabs: [], blueprints: [], graphs: [], materials: [], particleSystems: [], skeletons: [], skeletalMeshes: [], animations: [], animatorControllers: [], dataAssets: [], uiDocuments: [], variables: [] }, [], { id: 'test', name: 'Test', version: '1.0.0' });

describe('package validation before import', () => {
  it('normalizes legacy module packages but rejects unknown formats and corrupt collections', () => {
    expect(parsePackage({ ...empty(), kind: 'module' }).kind).toBe('asset');
    expect(() => parsePackage({ ...empty(), formatVersion: '99.0.0' })).toThrow(/version/i);
    expect(() => parsePackage({ ...empty(), kind: 'executable' })).toThrow();
    expect(() => parsePackage({ ...empty(), content: { prefabs: [], graphs: 'broken' } })).toThrow(/graphs/);
    expect(() => parsePackage({ ...empty(), kind: 'plugin' })).toThrow(/plugin module/);
  });
  it('rejects missing widget dependencies, duplicate identities, and component cycles', () => {
    const pkg = empty(), a = makeUIDocument('A', 'screen'), b = makeUIDocument('B', 'screen');
    a.root.children = [{ ...makeUIElement('component'), componentId: b.id }];
    pkg.content.uiDocuments = [a];
    expect(() => parsePackage(pkg)).toThrow(/missing UI component/);
    pkg.content.uiDocuments.push(b);
    b.root.children = [{ ...makeUIElement('component'), componentId: a.id }];
    expect(() => parsePackage(pkg)).toThrow(/cycle/);
    b.root.children = [makeUIElement('text')]; b.root.children.push(b.root.children[0]);
    expect(() => parsePackage(pkg)).toThrow(/duplicate widget/);
  });
  it('rejects dangling graph wires', () => {
    const pkg = empty();
    pkg.content.graphs = [{ id: 'graph', name: 'Bad graph', nodes: [], edges: [{ id: 'edge', source: 'absent', target: 'missing' }] }];
    expect(() => parsePackage(pkg)).toThrow(/missing node/);
  });
  it('rejects missing archive bytes and oversized or invalid archive paths', () => {
    const pkg = empty();
    pkg.assets = [{ id: 'asset', type: 'image', name: 'test.png', hash: 'a'.repeat(64), size: 3, createdAt: 0 }];
    const files = { 'package.json': new TextEncoder().encode(JSON.stringify(pkg)) };
    expect(() => readPackageFile(zipSync(files))).toThrow(/missing bytes/);
    expect(() => readPackageFile(zipSync({ ...files, '../escape': new Uint8Array([1]) }))).toThrow(/invalid archive path/);
  });
  it('rejects mismatched carried and inline hashes before any import can proceed', async () => {
    const pkg = empty();
    pkg.assets = [{ id: 'asset', type: 'image', name: 'test.png', hash: 'a'.repeat(64), size: 3, createdAt: 0 }];
    const archive = readPackageFile(writePackageArchive(pkg, new Map([['asset', new Uint8Array([1, 2, 3])]])));
    await expect(verifyPackageIntegrity(archive)).rejects.toThrow(/integrity check/);
    pkg.assets[0].data = 'data:image/png;base64,AQID';
    await expect(verifyPackageIntegrity({ pkg, bytes: new Map() })).rejects.toThrow(/integrity check/);
  });
});
