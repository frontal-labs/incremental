#!/usr/bin/env node
// M1 (PLAN 12.4), measured as data only: warm plan latency for a synthetic
// store, verify off. Load cost is measured with zero queries and subtracted.
// Usage: node bench/m1.mjs [tasks] [queries]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = path.join(root, 'core/dist/backplane');
const N = Number(process.argv[2] ?? 10000);
const Q = Number(process.argv[3] ?? 100);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backplane-m1-'));
const store = path.join(dir, 'store');
spawnSync(engine, ['init', '--store', store]);

const CTX = { lockfile: 'sha256:l1', tsconfig: 'sha256:t1', pkgjson: 'sha256:p1', runner: 'vitest@4.1.12', node: '22.11.0', fmt: 1, caps: { probes: true, dirs: true, env: true } };
const FILES = 5000;
const obsList = [];
for (let i = 0; i < N; i++) {
  const inputs = [{ kind: 'file', path: `pkg/src/f${i % FILES}.ts`, hash: `sha256:${(i % 97).toString(16).padStart(64, '0')}` },
    { kind: 'file', path: `pkg/src/f${(i * 7) % FILES}.ts`, hash: `sha256:${(i % 13).toString(16).padStart(64, '0')}` }];
  obsList.push({ task: `pkg/t/t${i}.test.ts`, baseline: 'b1', dirty: false, outcome: 'pass', context: CTX, inputs, outputs: [] });
}
const gen = () => {
  const lines = [JSON.stringify({ id: 1, method: 'hello', params: { protocol: 1, client: { name: 'm1', version: '0' } } })];
  for (let i = 0; i < obsList.length; i += 1000) lines.push(JSON.stringify({ id: 2 + i, method: 'observe_many', params: { observations: obsList.slice(i, i + 1000) } }));
  lines.push(JSON.stringify({ id: 999999, method: 'advance', params: { to: 'b1', expected: null } }));
  return lines.join('\n') + '\n';
};
const build = spawnSync(engine, ['serve', '--store', store], { input: gen(), encoding: 'utf8', maxBuffer: 1 << 30 });
if (build.status !== 0) { console.log('build failed', build.status, build.stderr.slice(0, 300)); process.exit(1); }
const query = { id: 7, method: 'affected', params: { changes: { baseline: 'b1', changes: [{ path: 'pkg/src/f1.ts', status: 'modified' }] },
  options: { baseline: 'b1', context: CTX, env: {}, verify: false } } };
const timeRun = (reqs) => {
  const input = [JSON.stringify({ id: 1, method: 'hello', params: { protocol: 1, client: { name: 'm1', version: '0' } } }), ...reqs.map((r) => JSON.stringify(r)), ''].join('\n');
  const t0 = process.hrtime.bigint();
  spawnSync(engine, ['serve', '--store', store], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
  return Number(process.hrtime.bigint() - t0) / 1e6;
};
const load = [0, 1, 2].map(() => timeRun([])).sort((a, b) => a - b)[1];
const withQ = [0, 1, 2].map(() => timeRun(Array.from({ length: Q }, (_, i) => ({ ...query, id: 100 + i })))).sort((a, b) => a - b)[1];
const perQuery = (withQ - load) / Q;
const log = fs.statSync(path.join(store, 'tg.log')).size;
console.log(JSON.stringify({ tasks: N, queries: Q, log_bytes: log, process_load_ms: +load.toFixed(1), per_query_ms_approx: +perQuery.toFixed(3), note: 'includes refresh stat and process overhead amortized; not the PLAN M1 harness' }));
fs.rmSync(dir, { recursive: true, force: true });
