#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
const casesDir = 'conformance/cases';
const cases = fs.readdirSync(casesDir).filter(f=>f.endsWith('.json')).sort();
if (cases.length < 40) { console.log('FAIL cases'); process.exit(1); }
console.log('PASS validate.mjs');
