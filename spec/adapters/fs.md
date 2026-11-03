# fs adapter (draft, not approved)

Status: draft. PLAN tier: later. Overlaps with the strace recorder (PLAN §11.5).

## Purpose
A generic file-read recorder for tasks that are not Vitest tests and not a known tool. It is the general form of what the Vitest recorder does through its preload.

## Task
Any command the adapter runs. Task id: a stable name given by the adapter's config, never a path or a pid (D-2).

## What it can observe
- On Linux: the strace oracle (PLAN §11.5). Successful opens, directory reads and ENOENT lookups under the configured roots, after realpath.
- On macOS: nothing comparable. There is no supported syscall tracer. Only declared inputs are available.

## What it cannot observe
- On macOS, every read that is not declared. The capability must be false and every run `dirty` for skips.
- Reads through memory-mapped files after open, depending on the tracer.
- Reads from paths outside the configured roots (excluded by design).

## Declared inputs
- Paths and globs the task is known to need. Recorded as `declared` (PLAN §9.5).

## Conformance cases (to write)
- Linux: a read the task makes is recorded, and its change invalidates the task.
- macOS: an undeclared read is not protected, and the run is `dirty`.
- An ENOENT probe is recorded, and creating the file invalidates the task (P6).

## Open questions
- Whether to ship this on macOS at all. Without a tracer the adapter only works with full declaration, which is the same as the config adapter.
