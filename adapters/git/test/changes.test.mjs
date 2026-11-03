// The git change source against a scratch repository (node:test).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const bin = path.join(root, 'adapters/git/dist/backplane-git');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backplane-git-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const git = (...a) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });

test('reports modified, deleted, renamed and untracked paths from a baseline', () => {
  git('init', '-q');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) fs.writeFileSync(path.join(dir, f), f + '\n');
  git('add', '.');
  git('commit', '-qm', 'one');
  const base = git('rev-parse', 'HEAD').stdout.trim();
  fs.appendFileSync(path.join(dir, 'a.txt'), 'more\n');
  git('rm', '-q', 'b.txt');
  git('mv', 'c.txt', 'd.txt');
  fs.writeFileSync(path.join(dir, 'u.txt'), 'u\n');
  const r = spawnSync(bin, ['changes', '--base', base, '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout);
  const cs = JSON.parse(r.stdout);
  assert.equal(cs.baseline, base);
  assert.equal(cs.dirty, true);
  assert.deepEqual(cs.changes, [
    { path: 'a.txt', status: 'modified' },
    { path: 'b.txt', status: 'deleted' },
    { path: 'd.txt', status: 'renamed', old_path: 'c.txt' },
    { path: 'u.txt', status: 'added' },
  ]);
});

test('an unknown baseline fails with invalid_params and no partial ChangeSet', () => {
  const r = spawnSync(bin, ['changes', '--base', 'deadbeef', '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.equal(JSON.parse(r.stdout).error.code, 'invalid_params');
});

test('a shell-unsafe baseline is refused before git runs', () => {
  const r = spawnSync(bin, ['changes', '--base', 'HEAD;rm', '--root', dir], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});
