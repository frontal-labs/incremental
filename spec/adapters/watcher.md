# watcher adapter

Status: built (`adapters/watcher`, `make test-watcher`). Spec sign-off: not recorded in DECISIONS.md. Matched to adapters/watcher/README.md on 2026-11-04.

## Purpose

A file-system watcher is a change source, not a recorder. It produces the ChangeSet for `affected` (protocol method `affected`, PROTOCOL.md), so that a live session can ask "what changed since the last run" without running git for the changes. As built, the ChangeSet comes from a stat walk compared with the window's snapshot. Events only wake the caller.

## Task

Built: tasks come from `tasks.json` (`{ "id", "command", "inputs" }`), because the loop needs tasks to observe. The draft said the watcher has no task; this is a deviation. The watcher itself is not a task.

## What it can observe

- Changes under the watched roots, found by a stat walk per cycle, compared with the snapshot taken when the window opened. A file whose mtime is within two seconds of the snapshot (the racy case) is hashed and compared by content.
- Renames are reported as `deleted` plus `added` (no `old_path`). Symbolic links are a loss.

## What it cannot observe (the core problem)

- The baseline. Events only say what changed since the watcher started. A watcher that restarts loses every change made while it was down. Without a baseline the adapter must fall back to running everything (fallback `baseline_mismatch`, ).
- Changes made before the watcher started. A watcher can never be the sole source of truth for skips. It can only be an input to a plan that has a git or file-hash baseline.
- Events can be coalesced or dropped by the OS. As built, events never decide what changed: the changes come from a stat walk compared with the window's snapshot (racy files by hash), so a dropped event cannot hide a change (see adapters/watcher/README.md).

## Declared inputs

- The watched roots, and each task's `inputs` in `tasks.json` (repo-relative files or directories, hashed when the task is observed).
- Ignored and never watched: `node_modules`, `.git`, `dist`, `.incremental`, `.toolchain`. A task input under them is refused with a config error.

## Conformance cases and tests

Adapters are not in the conformance suite . The planned cases below are adapter tests, and they are written to the built behavior:

- An edit with no event delivered is still reported, and a rebase clears it (test `an edit with no event delivered is still reported`, no watch open).
- A dropped or overflow event delays a run; it does not produce a partial ChangeSet, because no ChangeSet is read from events.
- A restart without a complete window runs everything. The first cycle of a session runs every task.

`npm test` builds the client, runs `tsc -b`, and runs `node --test` on `test/watcher.test.ts` (7 of 7 pass per DECISIONS).

## Open questions and gaps

- **Linux.** Recursive `fs.watch` was verified on darwin only. The Linux path is unverified.
- **Baseline.** A window starts only on a tree equal to the stored baseline. Uncommitted edits, or a commit made while no watcher ran, leave the session without history, so cycles run everything until another adapter (typescript, vitest) advances the store to a clean HEAD.
- **Git still runs.** The baseline check and the advance use the git change source every cycle. The ChangeSet itself does not.
- **Cost.** Each check walks the whole tree (about 10 ms per thousand entries). The watch loop waits at least ten times the last walk, so `--interval` is a minimum.
- **Coarse plans.** Context caps are all false, so in balanced mode a change to a path that is not a task input falls back (P6 or P7). This is sound and coarse.
- **Context.** The reserved context keys are constants. The runner is `incremental-watcher@<version>`.

Removed: whether a watcher is worth building. It is built (DECISIONS, "Adapters and bindings built from spec/adapters (2026-11-03)"). Whether the MCP server covers uncommitted edits more simply is not decided.
