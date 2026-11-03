#!/bin/sh
# Env probe: materialise one Os commit into W (same method as the driver) and run the plain unit suite.
S="$1"; SHA="$2"; W="$S/W"; OS=/Users/gabrielfonseca/Desktop/os
git -C "$W" ls-files -z | xargs -0 rm -f
git -C "$W" clean -ffdx -e node_modules >/dev/null
git -C "$OS" archive "$SHA" | tar -x -C "$W"
cd "$W" && NODE_ENV=test node node_modules/vitest/vitest.mjs run --root "$W" --configLoader runner --project unit --reporter=json --outputFile="$S/tmp/probe-$SHA.json" > "$S/tmp/probe-$SHA.log" 2>&1
echo "$SHA exit=$?"
node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const f=r.testResults.filter(t=>t.status!=="passed");console.log("files",r.testResults.length,"failed",f.length,"success",r.success);for(const t of f.slice(0,3))console.log("  ",t.name.split("/W/").pop(),(t.message||"").slice(0,160).replace(/\n/g," "))' "$S/tmp/probe-$SHA.json" 2>/dev/null || tail -3 "$S/tmp/probe-$SHA.log" | cut -c1-200
