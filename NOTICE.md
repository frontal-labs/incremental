# NOTICE

## Incremental project — experimental

The `incremental` engine (this repository) is experimental. It is a new, in-development
dependency-driven incremental computation system. It is not stable, it is not subject to any
compatibility guarantees, and it may change — including breaking changes — between releases without
notice. Do not depend on it for production workloads.

## Core language — Goose, experimental and new

The engine core (`core/`) is written in **Goose** (v2026.3, pinned in `.toolchain/`), a new systems
language that is itself experimental. Goose is not yet a stable language; its toolchain, standard
library, ABI, and language semantics may change between releases. The Goose toolchain is fetched
into `.toolchain/goose/` by `scripts/fetch-goose.sh` and is not part of this repository's source.

Goose is distributed by its maintainers under their own terms; see the Goose release in
`.toolchain/` and the `aardappel/goose` project for Goose-specific license and warranty
information. This repository makes no claims about Goose's fitness for any purpose.

## TypeScript compiler — tsc-rs, experimental and new

This project uses **tsc-rs** (`tsc-rs` 0.8.0, published as `@tsc-rs/typescript` when installed under
the name `typescript`), a Rust port of the Microsoft TypeScript 7 compiler, from
https://github.com/pingdotgg/ts-rust. tsc-rs is an early release and is experimental. It may
produce output that differs from Microsoft's `tsc`, may be incomplete for some TypeScript features,
and may change between versions. Report problems at https://github.com/pingdotgg/ts-rust/issues.

## Copyright and license of this project

Copyright (c) 2026 Frontal Labs, Inc.

The original authorship of this repository (the `incremental` project, excluding third-party
components listed below) is licensed under the Apache License, Version 2.0
(http://www.apache.org/licenses/LICENSE-2.0). See `LICENSE.md` for the full text.

## Third-party components and notices

This project incorporates or depends on third-party software. Those components keep their original
licenses and copyright notices; this NOTICE does not modify those licenses. Attribution is provided
for informational purposes only.

### tsc-rs / @tsc-rs/typescript (MIT AND Apache-2.0)

tsc-rs is a Rust port of Microsoft's native TypeScript compiler (originally Go), from
https://github.com/pingdotgg/ts-rust.

- TypeScript compiler source — Copyright (c) Microsoft Corporation, Apache License 2.0
- TypeScript lib files, localized diagnostics, JS launcher and JS API — copied from TypeScript
  without change; Apache License 2.0
- AST schema spec — from TypeScript, with edits for the Rust code generator
- Language Server Protocol meta model — Copyright (c) Microsoft Corporation, MIT License
- Portions of the Go standard library and `golang.org/x/text` — Copyright (c) The Go Authors,
  BSD 3-Clause License
- Unicode collation and normalization data — Copyright (c) Unicode, Inc., Unicode License v3
- Additional Go dependencies (see `node_modules/tsc-rs/NOTICE.txt`):
  - `github.com/zeebo/xxh3` — BSD 2-Clause
  - `golang.org/x/sync`, `golang.org/x/sys`, `golang.org/x/term`, `golang.org/x/text` — BSD
    3-Clause
  - `github.com/klauspost/cpuid/v2` — MIT
  - `github.com/Microsoft/go-winio` — MIT
  - `github.com/mackerelio/go-osstat` — Apache 2.0
  - `parcel-bundler/watcher` — MIT

Full license texts for these third-party components are bundled with tsc-rs in
`node_modules/tsc-rs/NOTICE.txt` and `node_modules/tsc-rs/licenses/`.

### TypeScript (Microsoft, Apache 2.0) — retained type definitions

Some packages in this repo (`adapters/typescript`, `adapters/biome`) import the `typescript`
compiler API for project-file discovery and config parsing. That import resolves to tsc-rs through
`@tsc-rs/typescript`; Microsoft's TypeScript type definitions remain subject to the Apache License
2.0 and their original copyrights.

### Other tooling

Build, lint, and format tooling used by this project (not distributed with it) includes:
biome, ruff, clang-format, rustfmt, shfmt, taplo, turbo, pnpm, Node.js, Vitest. Each is licensed
separately by its respective authors; this project makes no claim to those licenses.

## Disclaimer of warranty

Unless required by applicable law or agreed to in writing, the incremental project, the Goose
toolchain, and tsc-rs are provided on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied, including, without limitation, any warranties or conditions of
TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely
responsible for determining the appropriateness of using or redistributing the software and assume
any risks associated with your exercise of permissions under the applicable licenses.

## Limitation of liability

In no event and under no legal theory, whether in tort (including negligence), contract, or
otherwise, unless required by applicable law (such as deliberate and grossly negligent acts) or
agreed to in writing, shall any contributor or copyright holder be liable to you for damages,
including any direct, indirect, special, incidental, or consequential damages of any character
arising as a result of this license or out of the use or inability to use the software (including
but not limited to damages for loss of goodwill, work stoppage, computer failure or malfunction, or
any and all other commercial damages or losses), even if such contributor has been advised of the
possibility of such damages.
