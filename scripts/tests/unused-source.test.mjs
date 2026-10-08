import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { auditSource } from '../check-unused-source.mjs';

test('detects orphan files without rejecting browser, capture, plugin, worker, script, test or SDK consumers', () => {
  const root = mkdtempSync(join(tmpdir(), 'feather-source-audit-'));
  const write = (path, text = 'export const value = 1;') => {
    const absolute = join(root, path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, text);
  };
  try {
    write('tsconfig.app.json', JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx' } }));
    write('index.html', '<script type="module" src="/src/main.tsx"></script>');
    write('capture.html', '<script type="module" src="/src/capture.ts"></script>');
    write('src/main.tsx', "import './used'; import.meta.glob('./plugins/*.tsx', { eager: true }); new Worker(new URL('./worker.ts', import.meta.url));");
    write('src/used.ts');
    write('src/capture.ts');
    write('src/worker.ts', "import './workerHelper';");
    write('src/workerHelper.ts');
    write('src/plugins/local.tsx', "import '../pluginHelper';");
    write('src/pluginHelper.ts');
    write('src/extensions/index.ts', "export * from '../sdkOnly';");
    write('src/sdkOnly.ts');
    write('src/only.test.ts', "import './testHelper';");
    write('src/testHelper.ts');
    write('src/scriptOnly.ts');
    write('scripts/browser.mjs', 'page.evaluate("import(\'/src/scriptOnly.ts\')");');
    write('src/orphan.ts');
    assert.deepEqual(auditSource(root).unused, ['src/orphan.ts']);
    write('src/main.tsx', "import './used'; import './orphan'; import.meta.glob('./plugins/*.tsx'); new URL('./worker.ts', import.meta.url);");
    assert.deepEqual(auditSource(root).unused, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
