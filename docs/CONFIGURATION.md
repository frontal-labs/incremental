# BACKPLANE CONFIGURATION

## Config File
`backplane.config.json` at repo root (shape defined in PLAN.md 6.7):

```json
{
  "roots": ["."],
  "exclude": ["**/node_modules/**", ".git/**", ".backplane/**"],
  "ignore": [],
  "globalInputs": ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "package.json",
                   "tsconfig*.json", "vitest.config.*", "vite.config.*"],
  "policy": "balanced",
  "fallbackContextKeys": ["lockfile", "tsconfig", "pkgjson", "runner", "node", "fmt", "caps"],
  "adapters": {
    "vitest": { "testGlobs": ["**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,mts,cts}"] }
  }
}
```

## Settings
- **roots**: Directories to consider (default `["."]`)
- **exclude**: Globs matched against **canonical (realpath)** paths only (symlink resolution matters)
- **ignore**: Paths to ignore (P11) - dropped from changes, listed in `ignored`
- **globalInputs**: Any change triggers fallback (`global_input`) - affects everything
- **policy**: `"balanced"` (default) or `"conservative"` 
- **fallbackContextKeys**: Context keys that trigger fallback if changed (plus reserved keys always checked)
- **adapters**: Adapter-specific configuration

Glob support: `*`, `**`, `?`. `policy` affects behavior of unobserved adds/modifies (P6/P7).

## Environment Variables
| Variable | Purpose | Default |
|---|---|---|
| `BACKPLANE_STORE` | Override store directory | `<repo>/.backplane` |
| `BACKPLANE_TRACE_OUT` | Path for adapter trace output (preload writes here) | - |

## CLI Options
```bash
backplane init     [--store PATH]
backplane observe  --file FILE|-                        # one observation as JSON
backplane affected --changes FILE|- --baseline SHA --context FILE
                   [--verify] [--policy balanced|conservative]
backplane advance  --to SHA --expected SHA|null
backplane explain  --task ID
backplane forget   --task ID
backplane stats    [--json]
backplane compact
backplane serve    [--store PATH]                       # protocol over stdio
backplane version
```
Store defaults to `$BACKPLANE_STORE`, then `<repo>/.backplane`. Errors print JSON to stdout and message to stderr. Exit codes per protocol error mapping.

## Defaults
- `affected` options: `verify=false`, `policy="balanced"`
- Node client `connect()`: store from env/default, command `["backplane","serve"]`, timeout 10000ms, `restart=true`
