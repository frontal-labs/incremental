// The binary index image (tg.idx, format 2): a valid image is used without a
// rewrite, and a damaged one is rejected and rebuilt with the same answers.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.join(root, 'core/dist/backplane');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backplane-index-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const CTX = { lockfile: 'sha256:l1', tsconfig: 'sha256:t1', pkgjson: 'sha256:p1', runner: 'vitest@4.1.12', node: '22.11.0', fmt: 1, caps: { probes: true, dirs: true, env: true } };
const obs = (task, extra = {}) => ({ task, baseline: 'b1', dirty: false, outcome: 'pass', context: CTX, inputs: [{ kind: 'file', path: 'src/m.ts', hash: 'sha256:x' }], ...extra });
const serve = (store, reqs) => spawnSync(engine, ['serve', '--store', store, '--root', dir],
  { input: reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8' });
const stats = (store) => spawnSync(engine, ['stats', '--store', store], { encoding: 'utf8' });
const affected = (store) => {
  const chFile = path.join(dir, 'idx-changes.json');
  const ctxFile = path.join(dir, 'idx-ctx.json');
  fs.writeFileSync(chFile, JSON.stringify({ baseline: 'b1', changes: [{ path: 'src/m.ts', status: 'modified' }] }));
  fs.writeFileSync(ctxFile, JSON.stringify(CTX));
  return spawnSync(engine, ['affected', '--store', store, '--changes', chFile, '--baseline', 'b1', '--context', ctxFile, '--root', dir], { encoding: 'utf8' });
};

test('a valid image is used as is and a damaged body is rebuilt with the same answers', () => {
  const store = path.join(dir, 'img');
  assert.equal(spawnSync(engine, ['init', '--store', store]).status, 0);
  serve(store, [{ id: 1, method: 'observe', params: { observation: obs('a.test.ts') } },
    { id: 2, method: 'observe', params: { observation: obs('b.test.ts', { inputs: [{ kind: 'dir', path: 'src' }] }) } }]);
  const idx = path.join(store, 'tg.idx');
  const image = fs.readFileSync(idx);
  assert.equal(image.subarray(0, 4).toString('latin1'), 'BPIX');

  const before = stats(store).stdout;
  const first = affected(store);
  assert.equal(first.status, 0, first.stderr);
  assert.ok(fs.readFileSync(idx).equals(image), 'a valid image is not rewritten');

  const damaged = Buffer.from(image);
  damaged[damaged.length - 100] ^= 0x01;
  fs.writeFileSync(idx, damaged);
  const second = affected(store);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(second.stdout, first.stdout);
  assert.equal(stats(store).stdout, before);
  assert.ok(fs.readFileSync(idx).equals(image), 'a damaged image is rebuilt from the log');
});
