# protobuf adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Task
A `.proto` target: either a file compiled by `protoc` or a `buf` module/target. Task id: the repo-relative path of the target, or the `buf` target name (D-2).

## What the recorder can observe
- Imports: `protoc --dependency_out=<file>` writes a dependency list (the `.d` format) for each compile. The recorder reads it and hashes each listed file.
- `buf`: `buf build` plus `buf.yaml` and `buf.lock` declare the module's inputs. Imports from `buf.yaml` deps are resolved through the lockfile.

## What it cannot observe
- Generated code that a plugin writes is an output, not an input, and it is not stored.
- Plugin binaries and their versions: declared through the context, not observed per file.
- Dependencies pulled from the Buf registry at build time. Their content is identified by the lockfile digest, not by a read.

## Declared inputs
- `buf.yaml`, `buf.gen.yaml`, `buf.lock`, the plugin version list.

## Conformance cases (to write)
- Changing an imported `.proto` invalidates every target that imports it.
- A plugin version change invalidates every target that uses it.
- A `buf.lock` change is treated as a global input change.

## Open questions
- Whether `protoc --dependency_out` is complete for well-known types, which come from the protoc install and are not in the repo.
