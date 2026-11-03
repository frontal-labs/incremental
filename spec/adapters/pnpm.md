# pnpm adapter (draft, not approved)

Status: draft. PLAN tier: later. Also a context input: the lockfile is already a global input (docs/CONFIGURATION.md).

## Task
A workspace package, from `pnpm-workspace.yaml`, run with `pnpm --filter <name> run <script>`. Task id: `<package path>#<script>`, repo-relative.

## What the recorder can observe
- The workspace graph: `pnpm list -r --depth -1 --json` gives each package and its workspace dependencies.
- Package manifests: each package's `package.json` as a declared input.
- Root lockfile: `pnpm-lock.yaml`, hashed as a global input (already in the config).

## What it cannot observe
- The script's own reads. pnpm only runs the script; the script's inputs are the job of the tool the script calls. The adapter must be paired with that tool's recorder, or the task is `dirty`.
- Install-time side effects (postinstall scripts), which can change files outside the package.

## Declared inputs
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.npmrc`, root and package `package.json`.

## Conformance cases (to write)
- A dependency version change in the lockfile invalidates every package that uses it.
- A change in a workspace dependency invalidates its dependents.
- A script whose recorder is missing is `dirty`.

## Open questions
- Whether pnpm should be a separate adapter or a planner over the Vitest and other recorders. The second matches the plan's model, where adapters record and planners plan.
