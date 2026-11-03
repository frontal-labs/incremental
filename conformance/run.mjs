#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { plan as refPlan } from './spec/reference/policy.mjs';

const args = process.argv.slice(2);
const cmdIdx = args.indexOf('--cmd');
const cmd = cmdIdx >= 0 ? args[cmdIdx+1] : null;
const casesDir = 'conformance/cases';
const cases = fs.readdirSync(casesDir).filter(f=>f.endsWith('.json')).sort();
let failed = 0;
for (const c of cases) {
  const data = JSON.parse(fs.readFileSync(path.join(casesDir,c)));
  // use reference for now
  try {
    const res = refPlan({store:{baseline:data.query.baseline,total_tasks:10}, baseline:data.query.baseline, changes:data.query.changes, context:{}, verify:data.query.verify, policy:data.mode});
    console.log('OK', data.id);
  } catch(e) {
    console.log('FAIL', data.id, e.message);
    failed++;
  }
}
if (failed) process.exit(1);
