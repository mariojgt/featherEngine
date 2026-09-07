import { describe, expect, it } from 'vitest';
import { unzipSync } from 'fflate';
import ts from 'typescript';
import { createPluginStarter } from '../pluginStarter';
import { readPackageFile } from '../../project/packageArchive';

const options = { id: 'studio.inventory-tools', name: 'Inventory "Tools"', version: '1.0.0' };
describe('plugin starter creator', () => {
  it('generates compilable TSX, an installable manifest, and beginner instructions', () => {
    const files = unzipSync(createPluginStarter(options));
    const source = new TextDecoder().decode(files[`src/extensions/userPlugins/${options.id}.tsx`]);
    const result = ts.transpileModule(source, { fileName: 'plugin.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect(result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error)).toEqual([]);
    const pkg = readPackageFile(files[`${options.id}.nfpack`]).pkg;
    expect(pkg.kind).toBe('plugin');
    expect(pkg.meta.pluginId).toBe(options.id);
    expect(pkg.meta.name).toBe(options.name);
    expect(new TextDecoder().decode(files['README.txt'])).toContain('npm run build');
  });
  it.each(['../escape', 'not namespaced', 'Studio.Tools', 'studio/../../tools'])('rejects invalid or path-like plugin id %s', (id) => {
    expect(() => createPluginStarter({ ...options, id })).toThrow(/namespaced/);
  });
  it('rejects empty names and invalid package versions', () => {
    expect(() => createPluginStarter({ ...options, name: '' })).toThrow(/name/);
    expect(() => createPluginStarter({ ...options, version: 'latest' })).toThrow(/version/);
  });
});
