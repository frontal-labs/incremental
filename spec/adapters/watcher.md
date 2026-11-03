# watcher adapter (draft, not approved)

Status: draft. PLAN tier: later.

## Purpose
A file-system watcher is a change source, not a recorder. It produces ChangeSets from events, the way the git change source does (PLAN §11.7), so that a live session can ask "what changed since the last run" without running git.

## Task
None. It is a change source for `affected` (protocol method `affected`, PROTOCOL.md).

## What it can observe
- Create, modify, delete and rename events under the watched roots, after realpath.

## What it cannot observe (the core problem)
- The baseline. Events only say what changed since the watcher started. A watcher that restarts loses every change made while it was down. Without a baseline the adapter must fall back to running everything (fallback `baseline_mismatch`, PLAN §6.7).
- Changes made before the watcher started. A watcher can never be the sole source of truth for skips. It can only be an input to a plan that has a git or file-hash baseline.
- Events can be coalesced or dropped by the OS. The adapter must treat an overflow event as "unknown" and run everything (the "never skip silently" rule, docs/OVERVIEW.md).

## Declared inputs
- The watched roots and the ignore patterns.

## Conformance cases (to write)
- A modify event produces a ChangeSet entry (C-series change case).
- A dropped or overflow event produces a full fallback, not a partial ChangeSet.
- A restart without a baseline runs everything.

## Open questions
- Whether a watcher is worth building, given the git change source already covers committed, staged and untracked files. The watcher adds value only for uncommitted edits in a live session, which the MCP server might cover more simply.
