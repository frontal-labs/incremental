# @frontal-labs/incremental-watcher

The file-system change source (draft: `spec/adapters/watcher.md`). It turns events under the repository into a ChangeSet since the stored baseline, runs `affected`, runs the selected tasks, and advances only from a complete history. It is a change source, not a recorder, and it never sets the first baseline.

## Use

    incremental-watcher watch --tasks tasks.json [--interval MS] [--cycles N] [--json] [--store DIR] [--root DIR] [--timeout MS]

`tasks.json` is a JSON array of `{ "id", "command": [argv...], "inputs": [repo-relative files or directories] }`. Exit codes: 0 every run passed; 1 a task failed; 2 usage or config error; 4 engine or setup error.

## How a cycle works

1. A session starts a watch window. The window is complete only if the tree equalled the stored baseline B when it started (checked with `incremental-git`). Otherwise the session has no history and the first cycles run everything.
2. Each cycle: the changes since B (classified against the window's start snapshot) go to `affected`. Plan fallbacks, lost windows and the first cycle of a session run every task.
3. Selected tasks run, and each is observed with its declared file inputs (hashed). An observation is clean only if the tree is clean at HEAD, the window was complete and no event arrived during the run.
4. The store advances to HEAD only when all of that holds, the tree is clean and HEAD did not move. Otherwise it does not advance.

## Gaps (documented, not hidden)

- **Task definitions.** The draft says the watcher has no task. The loop needs tasks to observe, so they come from `tasks.json`. This is a deviation from the draft.
- **Silent drops are safe.** macOS FSEvents can coalesce or lose events without telling Node. The watcher never reads its changes from events. Events only wake the caller. `state` walks the tree and compares each file's stat with the snapshot taken when the window opened. A file whose mtime is within two seconds of the snapshot (the racy case) is hashed at snapshot time and compared by content. So a dropped event delays a run; it cannot hide a change. The test `an edit with no event delivered is still reported` checks this with no watch open. Recursive `fs.watch` was verified on darwin only.
- **Cost.** Each check walks the whole tree, linear in the file count: about 10 ms per thousand entries on this machine (measured on this repository). Directory mtimes cannot replace the walk, because an edit changes only its file's mtime. The watch loop therefore waits at least ten times the last walk (`--interval` is a minimum), so the check never takes more than about a tenth of the time.
- **Baseline.** A window starts only on a tree equal to the stored baseline. Uncommitted edits or a commit made while no watcher ran leave the session without history, so cycles run everything until another adapter (typescript, vitest) advances the store to a clean HEAD.
- **Git still runs.** The ChangeSet itself comes from events, but the baseline check and the advance use the git change source every cycle. The draft's "without running git" applies only to the ChangeSet.
- **Ignored directories.** `node_modules`, `.git`, `dist`, `.incremental` and `.toolchain` are never watched. A task input under them is refused with a config error.
- **Coarse plans.** Context caps are all false, so in balanced mode a change to a path that is not a task input falls back (P6 or P7). This is sound and coarse.
- **Renames** are reported as `deleted` plus `added` (no `old_path`). Symbolic links are a loss.
- **Cost.** Each window start walks the whole tree.
- **Context.** The reserved context keys are constants. The runner is `incremental-watcher@<version>`.

## Tests

`npm test` builds the client, runs `tsc -b`, and runs `node --test` on the integration tests in `test/watcher.test.ts`. The tests use a scratch git repository and the real engine.
