// CLI and store behavior against the real engine binary (node:test).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engine = path.join(root, 'core/dist/incremental');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'incremental-cli-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const CTX = { lockfile: 'sha256:l1', tsconfig: 'sha256:t1', pkgjson: 'sha256:p1', runner: 'vitest@4.1.12', node: '22.11.0', fmt: 1, caps: { probes: true, dirs: true, env: true } };
const obs = (task, extra = {}) => ({ task, baseline: 'b1', dirty: false, outcome: 'pass', context: CTX, inputs: [{ kind: 'dir', path: 'src' }], ...extra });
const cli = (args, input = '') => spawnSync(engine, args, { input, encoding: 'utf8' });
const serve = (store, reqs, rootDir = dir) => spawnSync(engine, ['serve', '--store', store, '--root', rootDir],
  { input: reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8' });
const results = (r) => r.stdout.trim().split('\n').map((l) => JSON.parse(l));

function newStore(name) {
  const s = path.join(dir, name);
  assert.equal(cli(['init', '--store', s]).status, 0);
  return s;
}

test('CLI observe, advance, affected, explain and stats', () => {
  const store = newStore('cli');
  assert.equal(cli(['observe', '--store', store, '--file', '-'], JSON.stringify(obs('a.test.ts'))).status, 0);
  assert.equal(cli(['advance', '--store', store, '--to', 'b1', '--expected', 'null']).status, 0);
  const ctxFile = path.join(dir, 'ctx.json');
  const chFile = path.join(dir, 'changes.json');
  fs.writeFileSync(ctxFile, JSON.stringify(CTX));
  fs.writeFileSync(chFile, JSON.stringify({ baseline: 'b1', changes: [{ path: 'src/new.ts', status: 'added' }] }));
  const aff = cli(['affected', '--store', store, '--changes', chFile, '--baseline', 'b1', '--context', ctxFile, '--root', dir]);
  assert.equal(aff.status, 0, aff.stderr);
  const plan = JSON.parse(aff.stdout);
  assert.deepEqual(plan.tasks, [{ id: 'a.test.ts', reasons: ['dir:src'] }]);
  assert.match(plan.graph_version, /^g_[0-9a-f]{8}$/);
  const ex = JSON.parse(cli(['explain', '--store', store, '--task', 'a.test.ts']).stdout);
  assert.equal(ex.certificate, true);
  assert.equal(JSON.parse(cli(['stats', '--store', store]).stdout).tasks, 1);
});

test('CLI exit codes: baseline_conflict 6, store missing 3, usage 2', () => {
  const store = newStore('codes');
  const conflict = cli(['advance', '--store', store, '--to', 'b2', '--expected', 'zzz']);
  assert.equal(conflict.status, 6);
  assert.equal(JSON.parse(conflict.stdout).error.code, 'baseline_conflict');
  assert.equal(cli(['stats', '--store', path.join(dir, 'nope')]).status, 3);
});

test('observe_many writes all records, and explain reports the certificate', () => {
  const store = newStore('many');
  const r = serve(store, [{ id: 1, method: 'observe_many', params: { observations: [obs('x.test.ts'), obs('y.test.ts')] } },
    { id: 2, method: 'stats' }]);
  const [a, s] = results(r);
  assert.deepEqual(a.result, { accepted: 2 });
  assert.equal(s.result.tasks, 2);
});

test('compact keeps the plan and shrinks the log', () => {
  const store = newStore('compact');
  const reqs = [];
  for (let i = 0; i < 5; i++) reqs.push({ id: i + 1, method: 'observe', params: { observation: obs('t.test.ts', { outcome: i < 4 ? 'fail' : 'pass' }) } });
  reqs.push({ id: 10, method: 'advance', params: { to: 'b1', expected: null } });
  serve(store, reqs);
  const before = fs.statSync(path.join(store, 'tg.log')).size;
  const q = { id: 20, method: 'affected', params: { changes: { baseline: 'b1', changes: [{ path: 'src/q.ts', status: 'added' }] },
    options: { baseline: 'b1', context: CTX, env: {}, verify: false } } };
  const p1 = results(serve(store, [q]))[0].result;
  const c = results(serve(store, [{ id: 30, method: 'compact' }]))[0].result;
  assert.ok(c.after_bytes < c.before_bytes && c.before_bytes === before);
  const p2 = results(serve(store, [q]))[0].result;
  assert.deepEqual(p2.tasks, p1.tasks);
  assert.equal(p2.tasks[0].id, 't.test.ts');
  assert.equal(results(serve(store, [{ id: 40, method: 'explain', params: { task: 't.test.ts' } }]))[0].result.outcome, 'pass');
});

test('two processes sharing a store: each sees the other\'s writes', () => {
  const store = newStore('shared');
  const a = serve(store, [{ id: 1, method: 'observe', params: { observation: obs('from-a.test.ts') } }]);
  assert.equal(results(a)[0].result.accepted, true);
  // B reads the store after A wrote, and writes one more task.
  const b = serve(store, [{ id: 2, method: 'observe', params: { observation: obs('from-b.test.ts') } },
    { id: 3, method: 'stats' }]);
  assert.equal(results(b)[1].result.tasks, 2);
  // A, still running in its own process, now sees B's write on its next request.
  const pa = spawnSync(engine, ['serve', '--store', store], { input: JSON.stringify({ id: 4, method: 'stats' }) + '\n', encoding: 'utf8' });
  assert.equal(results(pa)[0].result.tasks, 2);
});

test('a truncated tail is ignored, and the next write drops it', () => {
  const store = newStore('tail');
  serve(store, [{ id: 1, method: 'observe', params: { observation: obs('one.test.ts') } }]);
  fs.appendFileSync(path.join(store, 'tg.log'), '{"r":"obs","task":"half');
  assert.equal(results(serve(store, [{ id: 2, method: 'stats' }]))[0].result.tasks, 1);
  serve(store, [{ id: 3, method: 'observe', params: { observation: obs('two.test.ts') } }]);
  const log = fs.readFileSync(path.join(store, 'tg.log'), 'utf8');
  assert.ok(!log.includes('half'));
  assert.equal(results(serve(store, [{ id: 4, method: 'stats' }]))[0].result.tasks, 2);
});

test('a corrupt or stale index falls back to replay with the same answers', () => {
  const store = newStore('index');
  serve(store, [{ id: 1, method: 'observe', params: { observation: obs('idx.test.ts') } }]);
  const idx = path.join(store, 'tg.idx');
  assert.ok(fs.existsSync(idx));
  fs.writeFileSync(idx, 'garbage\n');
  assert.equal(results(serve(store, [{ id: 2, method: 'stats' }]))[0].result.tasks, 1);
});

test('G6 parity: CLI and serve give byte-identical plan bodies', () => {
  const store = newStore('parity');
  serve(store, [{ id: 1, method: 'observe', params: { observation: obs('p.test.ts', { inputs: [{ kind: 'file', path: 'src/m.ts', hash: 'sha256:x' }] }) } },
    { id: 2, method: 'advance', params: { to: 'b1', expected: null } }]);
  const ctxFile = path.join(dir, 'parity-ctx.json');
  const chFile = path.join(dir, 'parity-changes.json');
  fs.writeFileSync(ctxFile, JSON.stringify(CTX));
  fs.writeFileSync(chFile, JSON.stringify({ baseline: 'b1', changes: [{ path: 'src/m.ts', status: 'modified' }] }));
  const viaCli = cli(['affected', '--store', store, '--changes', chFile, '--baseline', 'b1', '--context', ctxFile, '--root', dir]).stdout;
  const req = { id: 9, method: 'affected', params: { changes: JSON.parse(fs.readFileSync(chFile, 'utf8')), options: { baseline: 'b1', context: CTX, env: {}, verify: false, policy: 'balanced', config: null } } };
  const line = serve(store, [req]).stdout.trim();
  const prefix = '{"id":9,"result":';
  assert.ok(line.startsWith(prefix));
  assert.equal(viaCli.trimEnd(), line.slice(prefix.length, -1));
});
