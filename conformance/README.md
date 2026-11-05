# Incremental Conformance

The language-neutral conformance suite for incremental Protocol v1 and the policy engine. Conformance ensures that any engine implementation answers `affected` identically, given the same observations and changes.

## Contents

| Path                     | Description                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `conformance/cases/`     | 40 conformance cases (C01–C40), covering policy rules P0–P11, fallbacks, confidence, verify, and protocol-level behavior. |
| `conformance/run.mjs`    | Conformance runner: executes the 40 cases through the engine (`core/dist/incremental`).                                   |
| `conformance/fuzz.mjs`   | Differential fuzz against the general reference implementation (3 seeds).                                                 |
| `conformance/adapters/`  | Adapter-related conformance material.                                                                                     |
| `conformance/spec/`      | Spec snapshots used by conformance.                                                                                       |
| `conformance/stores/`    | Test stores used by cases.                                                                                                |
| `conformance/worktrees/` | Test worktrees used by cases.                                                                                             |

## Running

From the repo root. The engine binary must be built first:

```sh
make build
make test-policy   # 40 conformance cases through the engine (cases: 40 pass)
make test-protocol # protocol-level cases C26, C34, C35, C40
make test-fuzz     # differential fuzz against the reference, 3 seeds
make check-spec    # schemas, reference policy, coverage matrix
```

## Guarantees

- Soundness first: a task is skipped only with a certificate (observation at the baseline whose inputs are all unchanged). No silent skips.
- Determinism: changes are processed in ascending `(path, status, old_path)` order; all plan lists are sorted; input order never changes output (`docs/spec/POLICY.md` section 5).
- A fallback is never an error: exit 0 with `fallback` set is the normal outcome of an unsafe-to-skip query.

## Status

All 40 cases pass; 34 query cases agree with the general reference; schemas and reference policy are checked against engine responses.

Evidence: `evidence/E1.txt` (protocol and conformance suite, `make check-spec`) and `evidence/E2.txt` (core engine: `make test-core test-policy test-protocol loc`).

Spec conformance verification is tracked in `status/SPEC_CONFORMANCE.json` (E1 verify). Open change requests are in `spec/CHANGE_REQUESTS.md`.

## Related

- `docs/spec/PROTOCOL.md`, `docs/spec/POLICY.md`, `docs/spec/FORMAT.md` — the specification under test
- `spec/reference/` — general reference implementation
- `docs/conformance/CONFORMANCE_AND_TESTING.md` — guarantees, testing commands
