// Core smoke tests: real engine runs against a scratch store (node:test).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.join(root, 'core/dist/incremental');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-smoke-'));
const store = path.join(dir, 'store');

const run = (args, input = '') => spawnSync(engine, args, { input, encoding: 'utf8' });
const hello = JSON.stringify({ id: 1, method: 'hello', params: { protocol: 1, client: { name: 't', version: '0' } } });

test('init creates a log with a header and is idempotent', () => {
  assert.equal(run(['init', '--store', store]).status, 0);
  assert.equal(run(['init', '--store', store]).status, 0);
  const head = fs.readFileSync(path.join(store, 'tg.log'), 'utf8').split('\n')[0];
  assert.equal(JSON.parse(head).r, 'hdr');
});

test('observe, advance and affected round-trip through serve', () => {
  const obs = { task: 'a.test.ts', baseline: 'b1', dirty: false, outcome: 'pass',
    context: { lockfile: 'sha256:l', tsconfig: 't', pkgjson: 'p', runner: 'r', node: 'n', fmt: 1, caps: { probes: true, dirs: true, env: true } },
    inputs: [{ kind: 'dir', path: 'src' }] };
  const lines = [hello,
    JSON.stringify({ id: 2, method: 'observe', params: { observation: obs } }),
    JSON.stringify({ id: 3, method: 'advance', params: { to: 'b1', expected: null } }),
    JSON.stringify({ id: 4, method: 'affected', params: { changes: { baseline: 'b1', changes: [{ path: 'src/new.ts', status: 'added' }] },
      options: { baseline: 'b1', context: obs.context, env: {}, verify: false } } })];
  const out = run(['serve', '--store', store], lines.join('\n') + '\n');
  assert.equal(out.status, 0, out.stderr);
  const res = out.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(res[3].result.tasks, [{ id: 'a.test.ts', reasons: ['dir:src'] }]);
  assert.equal(res[3].result.confidence, 'medium');
});

test('a corrupt record that is not the tail is store_corrupt (exit 3)', () => {
  const bad = path.join(dir, 'bad');
  run(['init', '--store', bad]);
  fs.appendFileSync(path.join(bad, 'tg.log'), '{not json\n{"r":"forget","task":"x"}\n');
  assert.equal(run(['serve', '--store', bad], hello + '\n').status, 3);
});

test('protocol mismatch closes the stream with exit 2', () => {
  const r = run(['serve', '--store', store], JSON.stringify({ id: 1, method: 'hello', params: { protocol: 9 } }) + '\n');
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout.trim()).error.code, 'protocol_mismatch');
});

test('a malformed line gets invalid_params with id null and the loop continues', () => {
  const r = run(['serve', '--store', store], hello + '\n{bad\n{"id":5,"method":"ping"}\n');
  const res = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(res[1].id, null);
  assert.equal(res[1].error.code, 'invalid_params');
  assert.deepEqual(res[2].result, { pong: true });
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));
