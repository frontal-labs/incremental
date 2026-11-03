import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Reference implementation of spec/POLICY.md (independent of core/).
// It is a second, plain-JavaScript reading of the rules, used for
// differential checks. It is not the product. Keep it general: no case
// is special-cased here.

const RESERVED = ['lockfile', 'tsconfig', 'pkgjson', 'runner', 'node', 'fmt', 'caps'];
const DEFAULT_GLOBALS = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'package.json',
  'tsconfig*.json', 'vitest.config.*', 'vite.config.*'];
const RANK = { baseline_mismatch: 5, context_missing: 4, global_input: 3, context_changed: 2, unobserved_input: 1 };

// Glob: '**' across '/', '*' within a segment, '?' one non-'/' byte.
export function globMatch(pat, s) {
  const re = pat;
  let out = '^';
  for (let i = 0; i < re.length; i++) {
    const ch = re[i];
    if (ch === '*' && re[i + 1] === '*') { out += '.*'; i++; if (re[i + 1] === '/') { out += '/?'; i++; } }
    else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(out + '$').test(s);
}

function parentOf(p) {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

// Scalar as canonical JSON text; objects as { key: scalar } in member order.
function canonScalar(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ':' + JSON.stringify(x)).join(',') + '}';
}

// Builds the state from protocol messages (observe, advance, forget).
export function buildState(messages) {
  const state = { baseline: null, tasks: new Map(), lastCtx: null };
  for (const m of messages) {
    if (m.method === 'observe') {
      const o = m.params.observation;
      const rec = { ...o, context: Object.fromEntries(Object.entries(o.context).map(([k, v]) => [k, canonScalar(v)])) };
      rec.inputs = (o.inputs || []).map((i) => ({ ...i, snapshot: i.snapshot ? Object.fromEntries(Object.entries(i.snapshot)) : undefined }));
      const t = state.tasks.get(o.task) || { forgotten: false, latest: null };
      t.latest = rec;
      t.forgotten = false;
      state.tasks.set(o.task, t);
      state.lastCtx = rec.context;
    } else if (m.method === 'advance') {
      state.baseline = m.params.to;
    } else if (m.method === 'forget') {
      const t = state.tasks.get(m.params.task);
      if (t) t.forgotten = true;
    }
  }
  return state;
}

// plan(state, query) -> plan object with the fields the cases compare.
// P10: the worktree file hashes to the recorded hash. Missing is stale.
function fileMatches(root, rel, hash) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const h = 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
  return h === hash;
}

export function plan(state, q, root = '.') {
  const config = q.config || {};
  const globals = config.globalInputs ?? DEFAULT_GLOBALS;
  const ignore = config.ignore ?? [];
  const keys = [...RESERVED, ...(config.fallbackContextKeys ?? []).filter((k) => !RESERVED.includes(k))];
  const env = q.env || {};
  const policy = q.policy || 'balanced';
  const verify = !!q.verify;

  // Known tasks: latest observed and not forgotten, plus declared ones.
  const known = new Map();
  for (const [id, t] of state.tasks) if (!t.forgotten && t.latest) known.set(id, t.latest);
  for (const id of q.declared_tasks || []) if (!known.has(id)) known.set(id, null);
  const ids = [...known.keys()].sort();
  const total = ids.length;
  const fallbackPlan = (reason) => ({
    tasks: ids.map((id) => ({ id, reasons: ['fallback'] })),
    unobserved: [], ignored: [], deleted_tasks: [], total_tasks: total, skipped: 0,
    fallback: { action: 'run_all', reason }, confidence: 'n/a', verify,
  });

  // P0, P0b.
  if (state.baseline === null || q.baseline !== state.baseline) return fallbackPlan('baseline_mismatch');
  if (q.context === undefined || q.context === null) return fallbackPlan('context_missing');

  const ignored = new Set();
  const changes = [];
  for (const c of q.changes) {
    if (ignore.some((g) => globMatch(g, c.path))) ignored.add(c.path);
    else changes.push(c);
  }

  let fb = null;
  const bump = (code) => { if (!fb || RANK[code] > RANK[fb]) fb = code; };
  // P1.
  if (changes.some((c) => globals.some((g) => globMatch(g, c.path)))) bump('global_input');
  // P2: store context is the latest observation's context.
  const storeCtx = state.lastCtx || {};
  const queryCtx = Object.fromEntries(Object.entries(q.context).map(([k, v]) => [k, canonScalar(v)]));
  for (const k of keys) {
    if (queryCtx[k] !== storeCtx[k]) bump('context_changed');
  }
  if (fb) return fallbackPlan(fb);

  const caps = q.context.caps || {};
  const capsOk = !!caps.probes && !!caps.dirs;
  const cons = policy === 'conservative';

  // Input index over latest observations.
  const latestOf = (id) => (known.get(id) || null);
  const fileIndex = new Set();
  for (const id of ids) {
    const o = latestOf(id);
    if (!o) continue;
    for (const i of o.inputs || []) if (i.kind === 'file' || i.kind === 'declared') fileIndex.add(i.path);
  }

  const reasons = new Map(); // id -> Set of reason strings
  const addR = (id, r) => { if (!reasons.has(id)) reasons.set(id, new Set()); reasons.get(id).add(r); };
  const unobserved = new Set();
  const deleted = new Set();

  const sorted = [...changes].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
    || a.status.localeCompare(b.status) || ((a.old_path || '') < (b.old_path || '') ? -1 : (a.old_path || '') > (b.old_path || '') ? 1 : 0));

  for (const c of sorted) {
    if (c.status === 'deleted' || c.status === 'renamed') {
      const old = c.status === 'deleted' ? c.path : c.old_path;
      for (const id of ids) {
        const o = latestOf(id);
        if (!o) continue;
        for (const i of o.inputs || []) {
          if ((i.kind === 'file' || i.kind === 'declared') && i.path === old) addR(id, 'removed_read:' + old);
          if (i.kind === 'dir' && i.path === parentOf(old)) addR(id, 'removed_listed:' + parentOf(old));
        }
      }
      if (known.has(old)) deleted.add(old);
    }
    if (c.status === 'deleted') continue;
    const p = c.path;
    // P3.
    for (const id of ids) {
      const o = latestOf(id);
      if (!o) continue;
      for (const i of o.inputs || []) {
        if ((i.kind === 'file' || i.kind === 'declared') && i.path === p) {
          addR(id, (i.kind === 'declared' ? 'declared:' : 'reads:') + p);
        }
      }
    }
    const inIndex = fileIndex.has(p);
    // P4, else P6, else P7.
    if (known.has(p) && (c.status === 'added' || c.status === 'modified')) {
      addR(p, 'self_changed');
    } else if (!inIndex && (c.status === 'added' || c.status === 'renamed')) {
      if (!cons && capsOk) {
        for (const id of ids) {
          const o = latestOf(id);
          if (!o) continue;
          for (const i of o.inputs || []) {
            if (i.kind === 'probe' && i.path === p) addR(id, 'probe:' + p);
            if (i.kind === 'dir' && i.path === parentOf(p)) addR(id, 'dir:' + parentOf(p));
          }
        }
      } else bump('unobserved_input');
    } else if (!inIndex && c.status === 'modified') {
      if (!cons && capsOk) unobserved.add(p); else bump('unobserved_input');
    }
  }
  if (fb) return fallbackPlan(fb);

  let high = verify;
  for (const id of ids) {
    const o = latestOf(id);
    if (!o) { addR(id, 'no_observation'); continue; }
    if (o.dirty) addR(id, 'dirty_observation');
    if (o.outcome === 'fail' || o.outcome === 'error') addR(id, 'failed_outcome');
    for (const i of o.inputs || []) {
      if (i.kind === 'env') {
        const cur = Object.prototype.hasOwnProperty.call(env, i.name) ? env[i.name] : 'unset';
        if (cur !== i.value_hash) addR(id, 'env_changed:' + i.name);
      }
      if (i.kind === 'env_all') {
        if (!i.snapshot) addR(id, 'env_all_changed');
        else {
          const snapKeys = Object.keys(i.snapshot);
          const differs = Object.keys(env).some((k) => i.snapshot[k] !== env[k])
            || snapKeys.some((k) => env[k] !== i.snapshot[k]);
          if (differs) addR(id, 'env_all_changed');
        }
      }
      if (verify && (i.kind === 'file' || i.kind === 'declared')) {
        if (!fileMatches(root, i.path, i.hash)) addR(id, 'stale:' + i.path);
      }
    }
  }

  const tasks = [];
  let invalid = 0;
  for (const id of ids) {
    const rs = reasons.get(id);
    if (!rs || rs.size === 0) continue;
    invalid++;
    const list = [...rs].sort();
    if (list.some((r) => r === 'no_observation' || r === 'dirty_observation' || r.startsWith('stale:'))) high = false;
    tasks.push({ id, reasons: list });
  }
  return {
    tasks,
    unobserved: [...unobserved].sort(),
    ignored: [...ignored].sort(),
    deleted_tasks: [...deleted].sort(),
    total_tasks: total,
    skipped: total - invalid,
    fallback: null,
    confidence: high ? 'high' : 'medium',
    verify,
  };
}
