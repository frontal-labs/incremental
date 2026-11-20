# `@incremental/engine`

Prebuilt native binaries for the Incremental compute engine (`core/dist/incremental`).

## Purpose

This package bundles the platform-specific native engine binary so consumers of
`@incremental/client` can run `incremental serve` / `incremental affected` /
`incremental init` etc. without building Goose from source.

## Installation

```sh
npm install @incremental/engine
```

## Binary resolution

`@incremental/client` resolves the engine binary through
`@incremental/engine.enginePath()`:

1. `INCREMENTAL_ENGINE` environment variable (explicit override)
2. Prebuilt binary bundled in this package
   (`prebuilds/<platform>-<arch>/incremental`)
3. Dev-mode fallback: `core/dist/incremental` in the incremental monorepo

## Supported platforms

| Platform | Arch  | Status                         |
| -------- | ----- | ------------------------------ |
| darwin   | arm64 | ✅ Prebuilt binary included (macOS ≥ 11.0) |
| darwin   | x64   | ✅ Prebuilt binary included (macOS ≥ 11.0) |
| linux    | x64   | ✅ Prebuilt binary included (needs glibc ≥ 2.34) |
| linux    | arm64 | ✅ Prebuilt binary included (needs glibc ≥ 2.34) |

Every bundled prebuild is built by `scripts/build-prebuilds.mjs` in the
publish workflow. `install.js` still downloads `incremental-<platform>-<arch>`
from the latest GitHub Release when a platform has no bundled prebuild; you can
also build locally with `make build` and point `INCREMENTAL_ENGINE` at the
result.

## Building the binary

From the incremental monorepo root:

```sh
make build   # builds core/dist/incremental via Goose toolchain
```

## Package contents

- `bin/incremental.js` — CLI entry point that execs the native binary
- `index.js` / `index.d.ts` — `enginePath()` and `engineDir()` exports
- `install.js` — postinstall script (verifies prebuilt binary or downloads)
- `prebuilds/<platform>-<arch>/incremental` — native engine binary

## Usage

```js
import { enginePath } from "@incremental/engine";

console.log(enginePath()); // /path/to/incremental binary
```

## License

Apache-2.0
