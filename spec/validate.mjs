#!/usr/bin/env node
// Validates the spec and the conformance suite (PLAN.md E1). It checks:
//  1. the 40 case files are present and well formed;
//  2. the coverage matrix: every rule of PLAN 8.2 is exercised by a case
//     (rule-to-case map from PLAN 12.2);
//  3. every query-based case, run through the reference policy
//     (spec/reference/policy.mjs), gives the expected answer;
//  4. the JSON schemas parse, and real engine responses validate against them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildState, plan } from './reference/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = path.join(root, 'conformance/cases');
const schemasDir = path.join(root, 'spec/schemas');
const engine = path.join(root, 'core/dist/backplane');
const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();
let bad = 0;
const fail = (msg) => { console.log('FAIL ' + msg); bad++; };

// PLAN 12.2: the rules each case exercises. A rule of 8.2 with no case is a
// gap in the matrix.
const RULES_OF_CASE = {
  C01: ['P3'], C02: ['P3'], C03: ['P4'], C04: ['P8'], C05: ['P6'], C06: ['P6'], C07: ['P6'], C08: ['P6'],
  C09: ['P7'], C10: ['P7'], C11: ['P11'], C12: ['P1'], C13: ['P2'], C14: ['P2b'], C15: ['P2b'],
  C16: ['P5'], C17: ['P5'], C18: ['P5', 'P6'], C19: ['P9'], C20: ['P9'], C21: ['P8'], C22: ['P10'],
  C23: ['P10'], C24: ['P10'], C25: ['P0'], C26: [], C27: ['P0b'], C28: ['P1', 'P2'], C29: [], C30: [],
  C31: [], C32: [], C33: [], C34: [], C35: [], C36: [], C37: [], C38: [], C39: ['P3'], C40: [],
};
const RULES = ['P0', 'P0b', 'P1', 'P2', 'P2b', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];
const covered = new Set(Object.values(RULES_OF_CASE).flat());
for (const r of RULES) if (!covered.has(r)) fail(`coverage: rule ${r} has no case`);

if (files.length < 40) fail(`cases: found ${files.length}, need 40`);
const readMessages = (file) => fs.readFileSync(path.join(root, file), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const protocolLevel = (c) => c.action || c.raw_lines || c.post_raw_log !== undefined || c.kind || c.requires;

let refRun = 0;
for (const f of files) {
  const c = JSON.parse(fs.readFileSync(path.join(casesDir, f), 'utf8'));
  if (c.id + '.json' !== f) fail(`${f}: id ${c.id} does not match the file name`);
  if (!c.desc || !c.mode || !c.store || !c.store.from) fail(`${f}: missing desc, mode or store`);
  if (protocolLevel(c) || !c.query) continue;
  const messages = [...readMessages(c.store.from), ...(c.store.append ?? [])];
  const state = buildState(messages);
  const q = { ...c.query, policy: c.mode, config: c.config, env: c.query.env };
  const wt = path.join(root, 'conformance/worktrees', c.worktree ?? 'base');
  const got = plan(state, q, wt);
  refRun++;
  const diffs = [];
  for (const key of ['tasks', 'unobserved', 'ignored', 'deleted_tasks', 'fallback', 'confidence']) {
    if (!(key in c.expect)) continue;
    if (JSON.stringify(got[key]) !== JSON.stringify(c.expect[key])) {
      diffs.push(`${key}: want ${JSON.stringify(c.expect[key])} got ${JSON.stringify(got[key])}`);
    }
  }
  if (diffs.length) fail(`${c.id} (reference): ${diffs.join('; ')}`);
}
console.log(`reference ran ${refRun} query cases; ${files.length - refRun} protocol-level cases are run by conformance/run.mjs`);

// ---- schemas -------------------------------------------------------------

// The keywords the schemas in spec/schemas use: type, required, properties,
// items, enum, $ref (to a sibling file). Anything else is ignored.
function check(value, schema, where, dir) {
  const errs = [];
  if (schema.$ref) {
    const target = JSON.parse(fs.readFileSync(path.join(dir, schema.$ref), 'utf8'));
    return check(value, target, where, dir);
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
    const k = kind(value);
    const ok = types.some((t) => t === k || (t === 'number' && k === 'integer'));
    if (!ok) return [`${where}: want ${types.join('|')}, got ${k}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${where}: ${JSON.stringify(value)} not in enum`);
  if (schema.required && value && typeof value === 'object') {
    for (const key of schema.required) if (!(key in value)) errs.push(`${where}: missing ${key}`);
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in value) errs.push(...check(value[key], sub, `${where}.${key}`, dir));
    }
  }
  if (schema.items && Array.isArray(value)) {
    value.forEach((v, i) => errs.push(...check(v, schema.items, `${where}[${i}]`, dir)));
  }
  return errs;
}

// Schemas must parse. A schema with no constraints is a failure.
for (const f of fs.readdirSync(schemasDir).filter((x) => x.endsWith('.json'))) {
  const s = JSON.parse(fs.readFileSync(path.join(schemasDir, f), 'utf8'));
  if (Object.keys(s).filter((k) => k !== '$schema').length === 1 && s.type === 'object') fail(`schema ${f} has no constraints`);
}

// Real engine responses, validated against their schemas.
if (!fs.existsSync(engine)) {
  fail(`engine not found at ${engine}; run make build`);
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backplane-schema-'));
  const store = path.join(dir, 'store');
  spawnSync(engine, ['init', '--store', store]);
  const ctx = { lockfile: 'sha256:l1', tsconfig: 'sha256:t1', pkgjson: 'sha256:p1', runner: 'vitest@4.1.12', node: '22.11.0', fmt: 1, caps: { probes: true, dirs: true, env: true } };
  const reqs = [
    { id: 1, method: 'hello', params: { protocol: 1, client: { name: 'v', version: '0' } } },
    { id: 2, method: 'observe', params: { observation: { task: 'a.test.ts', baseline: 'b1', dirty: false, outcome: 'pass', context: ctx, inputs: [{ kind: 'dir', path: 'src' }], outputs: [] } } },
    { id: 3, method: 'advance', params: { to: 'b1', expected: null } },
    { id: 4, method: 'affected', params: { changes: { baseline: 'b1', changes: [{ path: 'src/x.ts', status: 'added' }] }, options: { baseline: 'b1', context: ctx, env: {}, verify: false } } },
    { id: 5, method: 'stats' },
    { id: 6, method: 'explain', params: { task: 'a.test.ts' } },
    { id: 7, method: 'observe', params: {} },
  ];
  const out = spawnSync(engine, ['serve', '--store', store], { input: reqs.map((r) => JSON.stringify(r)).join('\n') + '\n', encoding: 'utf8' });
  const res = Object.fromEntries(out.stdout.trim().split('\n').map((l) => JSON.parse(l)).map((r) => [r.id, r]));
  const schema = (name) => JSON.parse(fs.readFileSync(path.join(schemasDir, name), 'utf8'));
  const checks = [
    ['response.json', res[1], schema('response.json')],
    ['response.json', res[7], schema('response.json')],
    ['plan.json', res[4] && { ...res[4].result }, schema('plan.json')],
    ['stats.json', res[5] && res[5].result, schema('stats.json')],
    ['explanation.json', res[6] && res[6].result, schema('explanation.json')],
    ['error.json', res[7] && res[7].error, schema('error.json')],
  ];
  for (const [name, value, s] of checks) {
    if (value === undefined) { fail(`${name}: no engine response to check`); continue; }
    const errs = check(value, s, name, schemasDir);
    if (errs.length) fail(`${name}: ${errs.join('; ')}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

if (bad) {
  console.log('FAIL validate.mjs');
  process.exit(1);
}
console.log('PASS validate.mjs');
