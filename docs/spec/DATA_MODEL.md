# INCREMENTAL DATA MODEL

## Core Concepts
| Term | Definition |
|---|---|
| **Task** | Named unit of work (adapter-defined ID). Vitest adapter uses test file paths. |
| **Input** | Something a task depends on (file, dir, probe, env, env_all, declared). |
| **Output** | File produced by task (recorded for explanation, not used for invalidation in v1). |
| **Observation** | Recorded run of a task: inputs, outputs, outcome, baseline, dirty state, context. |
| **Baseline** | Opaque string naming state graph is valid for (usually git commit SHA). |
| **Context** | Environment of observation (tool versions, lockfile hash, env snapshot). |
| **ChangeSet** | Changes between baseline and current state (path + status). |
| **Plan** | Engine answer: which tasks invalid and why, unknowns, confidence. |
| **Certificate** | Evidence making skip safe: observation at baseline where all inputs unchanged. |

## Input Kinds
| Kind | Fields | Meaning |
|---|---|---|
| `file` | `path`, `hash` | Task read this file |
| `dir` | `path` | Task listed this directory (any entry change matters) |
| `probe` | `path` | Task looked for path that didn't exist (creation matters) |
| `env` | `name`, `value_hash` or `"unset"` | Task read environment variable |
| `env_all` | `snapshot` | Task enumerated whole environment (any change matters) |
| `declared` | `path` (via fv) | Adapter declared input without observing read |

## Observation Schema
```json
{
  "task": "packages/core/src/math.test.ts",
  "baseline": "b1",
  "dirty": false,
  "context": {
    "lockfile": "sha256:...",
    "tsconfig": "sha256:...",
    "pkgjson": "sha256:...",
    "runner": "vitest@4.1.12",
    "node": "22.11.0",
    "fmt": 1,
    "caps": {"probes": true, "dirs": true, "env": true}
  },
  "inputs": [
    {"kind": "file", "path": "packages/core/src/math.ts", "hash": "sha256:..."},
    {"kind": "dir", "path": "packages/app/plugins"},
    {"kind": "probe", "path": "packages/core/src/helpers.ts"},
    {"kind": "env", "name": "TG_FIXTURE_MODE", "value_hash": "sha256:..."},
    {"kind": "env_all", "snapshot": {"TG_FIXTURE_MODE": "sha256:..."}}
  ],
  "outputs": [],
  "outcome": "pass|fail|error|none",
  "duration_ms": 412
}
```

Required: `task`, `baseline`, `context` (with reserved keys). Inputs not sorted by client - engine sorts them.

## ChangeSet Schema
```json
{
  "baseline": "b1",
  "head": "...",
  "changes": [
    {"path": "packages/core/src/math.ts", "status": "modified"},
    {"path": "packages/core/src/new.ts", "status": "renamed", "old_path": "packages/core/src/old.ts"}
  ]
}
```
Status: `modified`, `added`, `deleted`, `renamed`. `old_path` required for renamed. Uncommitted changes appear as entries relative to baseline.
