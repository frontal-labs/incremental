# @frontal-labs/incremental-protobuf

The protoc and buf adapter for incremental, built from `spec/adapters/protobuf.md`.

    npm test                                  # build, then node --test
    node dist/src/run.js run [--base REF] [--json] [--all] [--root DIR] [--store DIR]

Exit codes follow the TypeScript adapter: 0 ok and advanced, 1 a target failed, 2 usage,
4 engine or setup error, 7 ran but not advanced.

## Tasks

- Every `.proto` file under the root is a protoc task. Its id is the repo-relative path.
- Every `buf.yaml` is a buf module task. Its id is the repo-relative path of the file.
- A `.proto` inside a buf module compiles with the module directory as its import root, since
  buf imports are module-relative. Otherwise the import root is the repo root.

## Real versus declared

Real (observed on each run):

- protoc reads: `protoc --dependency_out` lists every file it read, including the target. Each
  repo file in that list becomes a `file` input, hashed after the compile.
- buf module files: `buf ls-files` lists them. They become `file` inputs.

Declared:

- A buf module's `buf.yaml`, `buf.lock` and `buf.gen.yaml` are `declared` inputs.
- Context `lockfile` is the digest of every `buf.lock`. A lock change falls back to running all targets.
- Context `runner` names the protoc version, a digest of the well-known types in protoc's install,
  and the buf version (or `absent`).

## Well-known types

protoc reads `google/protobuf/*.proto` from its own install (`<protoc>/../include`), not from the
repo. These reads are not repo inputs. Their content is covered by the context digest in
`runner`, so an install change (version or content) falls back to running all targets.

## Gaps

- **Dependency list is complete only for a successful compile.** protoc writes no `.d` file when
  the compile fails. Such an observation is marked `dirty`. It is a fail outcome anyway, so the
  target stays invalid until it compiles.
- **Probes and directory listings are not observed.** protoc searches each import path, and
  the failed lookups are not recorded. Capabilities `probes`, `dirs` and `env` are false. So an
  added or modified file that is not a read input (for example, a new `.proto` that could shadow
  an import) falls back to running every target, as the policy requires.
- **Inputs are hashed after the compile.** A file edited during the run is caught by the
  end-of-run checks (dirty worktree, HEAD moved). An edit that is reverted before the end of the
  run is not caught.
- **Plugins and generated code are not run.** No `buf generate` and no protoc plugin. The
  descriptor set is a scratch output, deleted after each compile. So plugin version changes are
  not tracked, and `buf.gen.yaml` is declared but not read.
- **buf registry dependencies are not read.** A module with `deps:` in `buf.yaml` uses buf's cache
  or the registry. Those files are identified by `buf.lock`, not by a read. Offline, such a build
  fails and the target errors (not advanced).
- **buf module import paths.** A buf module with `path:` other than `.` may compile differently
  under protoc, since protoc resolves imports from the `buf.yaml` directory. A compile that
  fails is reported as a failure. It is not hidden.
- **`buf.lock` is global per context, not per task.** A change to any lock falls back to running
  all targets, matching the spec's global input rule.

## Tests

`test/adapter.test.ts` uses a scratch git repository and the real engine. It covers discovery,
dependency parsing, the first run, an imported edit, an unrelated edit, a compile error, an
uncommitted change (exit 7) and a buf module built offline. buf ran without registry access (the
module has no deps), so no test needs the network.

## Versions

protoc 36.2 (libprotoc), buf 1.70.0. Override the binaries with `INCREMENTAL_PROTOC` and
`INCREMENTAL_BUF`. The engine comes from `core/dist/incremental` (or `INCREMENTAL_ENGINE`), and the git
change source from `adapters/git/dist/incremental-git` (or `INCREMENTAL_GIT`).
