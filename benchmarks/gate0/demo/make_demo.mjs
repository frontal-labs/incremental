#!/usr/bin/env node
/**
 * Generates a small synthetic Vitest monorepo for local demo/Gate 0 work.
 * Usage: node benchmarks/gate0/demo/make_demo.mjs [targetDir]
 * Default target: demo-repo/ (workspace root relative).
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd(), process.argv[2] || 'demo-repo');
fs.mkdirSync(root, { recursive: true });

function write(rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

function run(args, opts = {}) {
  return execFileSync(args[0], args.slice(1), { cwd: root, stdio: 'pipe', encoding: 'utf8', ...opts });
}

const files = {
  'package.json': JSON.stringify({
    name: 'incremental-demo-repo',
    private: true,
    type: 'module',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '^2.0.0' }
  }, null, 2) + '\n',
  'vitest.config.ts': `import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/*/test/**/*.test.ts'] } });
`,
  'packages/util/package.json': JSON.stringify({ name: '@demo/util', type: 'module' }, null, 2) + '\n',
  'packages/util/src/math.ts': `export const add = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\n`,
  'packages/util/test/math.test.ts': `import { describe, expect, it } from 'vitest';
import { add, mul } from '../src/math';
describe('util', () => { it('adds', () => expect(add(2, 3)).toBe(5)); it('muls', () => expect(mul(2, 3)).toBe(6)); });
`,
  'packages/app/package.json': JSON.stringify({ name: '@demo/app', type: 'module', dependencies: { '@demo/util': 'workspace:*' } }, null, 2) + '\n',
  'packages/app/src/calc.ts': `import { add } from '../../util/src/math';
export const sum3 = (a: number, b: number, c: number) => add(add(a, b), c);
`,
  'packages/app/test/calc.test.ts': `import { describe, expect, it } from 'vitest';
import { sum3 } from '../src/calc';
describe('app', () => { it('sums', () => expect(sum3(1, 2, 3)).toBe(6)); });
`,
  '.gitignore': 'node_modules/\n'
};

for (const [rel, content] of Object.entries(files)) write(rel, content);

if (!fs.existsSync(path.join(root, '.git'))) {
  run(['git', 'init']);
  run(['git', 'config', 'user.email', 'demo@example.com']);
  run(['git', 'config', 'user.name', 'Demo']);
  run(['git', 'add', '-A']);
  run(['git', 'commit', '-m', 'init demo repo']);
}

console.log(`demo repo ready at ${root}`);
console.log('Next: (cd demo-repo && npm install) then run Vitest or the Incremental adapter against it.');
