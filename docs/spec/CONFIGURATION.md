# INCREMENTAL CONFIGURATION

## Config File

`incremental.config.json` at repo root (shape defined in 6.7):

```json
{
  "roots": ["."],
  "exclude": ["**/node_modules/**", ".git/**", ".incremental/**"],
  "ignore": [],
  "globalInputs": [
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "package.json",
    "tsconfig*.json",
    "vitest.config.*",
    "vite.config.*"
  ],
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

| Variable                | Purpose                                             | Default               |
| ----------------------- | --------------------------------------------------- | --------------------- |
| `INCREMENTAL_STORE`     | Override store directory                            | `<repo>/.incremental` |
| `INCREMENTAL_TRACE_OUT` | Path for adapter trace output (preload writes here) | -                     |

## CLI Options

```bash
incremental init     [--store PATH]
incremental observe  --file FILE|-                        # one observation as JSON
incremental affected --changes FILE|- --baseline SHA --context FILE
                   [--verify] [--policy balanced|conservative]
incremental advance  --to SHA --expected SHA|null
incremental explain  --task ID
incremental forget   --task ID
incremental stats    [--json]
incremental compact
incremental serve    [--store PATH]                       # protocol over stdio
incremental version
```
Store defaults to `$INCREMENTAL_STORE`, then `<repo>/.incremental`. Errors print JSON to stdout and message to stderr. Exit codes per protocol error mapping.

## Defaults

- `affected` options: `verify=false`, `policy="balanced"`
- Node client `connect`: store from env/default, command `["incremental","serve"]`, timeout 10000ms, `restart=true`
