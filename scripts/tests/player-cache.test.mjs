import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playerInputHash, readPlayerCache, writePlayerCache } from '../lib/player-cache.mjs';

test('cached runtime rejects source changes, edited files, and extra output', () => {
  const root = mkdtempSync(join(tmpdir(), 'feather-cache-test-'));
  const write = (name, contents) => writeFileSync(join(root, name), contents);
  try {
    for (const dir of ['src', 'public', 'dist-player']) mkdirSync(join(root, dir));
    write('src/player.ts', 'original'); write('dist-player/index.html', '<html>player</html>');
    const hash = playerInputHash(root); writePlayerCache(root, hash, true);
    assert.equal(readPlayerCache(root, hash).checked, true);
    write('src/player.ts', 'changed'); assert.equal(readPlayerCache(root, playerInputHash(root)), null);
    write('src/player.ts', 'original'); assert.ok(readPlayerCache(root, playerInputHash(root)));
    write('dist-player/index.html', '<html>changed</html>'); assert.equal(readPlayerCache(root, hash), null);
    writePlayerCache(root, hash, true); write('dist-player/game.json', '{}'); assert.equal(readPlayerCache(root, hash), null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
