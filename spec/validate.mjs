#!/usr/bin/env node
// Validates the conformance suite (spec/PLAN.md E1). Checks that all 40
// case files are present and well formed, and runs every query-based case
// through the reference policy (spec/reference/policy.mjs). Protocol-level
// cases (action, raw_lines, post_raw_log, concurrency, requires) are run
// by conformance/run.mjs against the engine. Coverage matrix: see DECISIONS.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState, plan } from './reference/policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const casesDir = path.join(root, 'conformance/cases');
const files = fs.readdirSync(casesDir).filter((f) => f.endsWith('.json')).sort();
let bad = 0;
const fail = (msg) => { console.log('FAIL ' + msg); bad++; };

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
if (bad) {
  console.log('FAIL validate.mjs');
  process.exit(1);
}
console.log('PASS validate.mjs');
