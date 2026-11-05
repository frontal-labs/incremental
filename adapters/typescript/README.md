# TypeScript adapter (`adapters/typescript`)

`incremental-typescript run` checks each `tsconfig.json` in the repo with `tsc --noEmit`, one task per project (PLAN 10.4). Its inputs come from `tsc --listFilesOnly`, the `extends` chain, and the `package.json` files on each project's paths. Every input is hashed when the project is observed.

```sh
incremental-typescript run [--base REF] [--json] [--all] [--store DIR] [--root DIR] [--timeout MS]
```

Exit codes: 0 ok and advanced; 1 a project failed to type check; 2 usage; 4 engine error; 7 ran, baseline not advanced.

- Full design, as built, and its gaps: `spec/adapters/typescript.md`.
- Tests: `make test-typescript` (6 integration tests against the real engine and a scratch git repo).
- Known cost: probes and dirs are not observed, so an edit to a file no project reads runs every project (P7 `unobserved_input`). This is sound. Shadow mode and a worker pool are not built.
