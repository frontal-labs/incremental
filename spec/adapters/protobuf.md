# protobuf adapter

Status: built (adapters/protobuf, make test-protobuf). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/protobuf/README.md on 2026-11-04. PLAN tier: later.

## Task
Two kinds of task. Every `.proto` file under the root is a `protoc` task. Every `buf.yaml` is a `buf` module task, one per module. Task id: the repo-relative path (the `.proto` file, or the `buf.yaml` file) (D-2). A `.proto` inside a buf module compiles with the module directory as its import root; otherwise the import root is the repo root.

## What the recorder can observe
- Imports: `protoc --dependency_out=<file>` lists every file protoc read, including the target. Each repo file in that list becomes a file input, hashed after the compile. A failed compile writes no `.d` file, so that observation is `dirty`.
- `buf`: `buf ls-files` lists the module's files, which become file inputs. Registry dependencies (`deps:` in `buf.yaml`) are not read; they are identified by `buf.lock`.

## What it cannot observe
- Generated code: plugins are not run (no `buf generate`, no protoc plugin). The descriptor set is a scratch output, deleted after each compile.
- Plugin binaries and their versions: not tracked. `buf.gen.yaml` is declared but not read.
- Dependencies pulled from the Buf registry at build time. Their content is identified by the lockfile digest, not by a read.
- protoc's probes and directory listings (failed import lookups are not recorded).

## Declared inputs
- For a buf module: `buf.yaml`, `buf.gen.yaml`, `buf.lock`.
- Context `lockfile`: the digest of every `buf.lock`. A lock change falls back to running all targets (a global input).
- Context `runner`: the protoc version, a digest of the well-known types in protoc's install, and the buf version (or `absent`). Well-known types (`google/protobuf/*.proto`) are read from protoc's install, not the repo, and are covered by this digest; an install change falls back to running all targets.

## Adapter tests
`adapters/protobuf/tests/adapter.test.ts` runs the real engine in a scratch git repository. These are adapter tests, not conformance cases (see below). They cover: discovery of each `.proto` and `buf.yaml` as a target; protoc dependency-file parsing; the first run compiling every target and advancing; an edit to an imported `.proto` invalidating every target that imports it; an edit to an unrelated `.proto` invalidating only its own target; a compile error failing its target with exit 1 while the baseline still advances; an uncommitted change leaving the baseline in place with exit 7; and a buf module built offline as one task.

## Gaps
- The adapter is not in the conformance suite (PLAN §12).
- A plugin version change is not tracked, because plugins are not run.
- The dependency list is complete only for a successful compile.
- Probes, directory listings and env are not observed (capabilities `probes`, `dirs`, `env` are false). A new `.proto` that could shadow an import is not a read input, so it falls back to running every target.
- Inputs are hashed after the compile. An edit reverted before the end of the run is not caught by the end-of-run checks.
- A buf module with `path:` other than `.` may compile differently under protoc. A failing compile is reported as a failure.
- Offline, a module with registry `deps:` fails and the target errors (not advanced).

## Open questions
- None open in the README or DECISIONS.md. The well-known-types question is answered by the `runner` context digest (see Declared inputs).
