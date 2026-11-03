# Backplane Specification

The backplane specification: protocol, policy, store format, schemas, reference implementation, conformance cases, and change requests. The specification is the contract between the engine (`core/`), the bindings (`bindings/`), and the adapters (`adapters/`).

## Contents

| Path | Description |
|---|---|
| `spec/PROTOCOL.md` | backplane Protocol v1: transport (JSON Lines over stdio), handshake (`hello`), methods (`observe`, `affected`, `explain`, `stats`, ...), errors, 10 s request budget. |
| `spec/POLICY.md` | Policy engine: `plan(state, query)`, rules P0–P11, fallback priority, confidence, determinism, verify/stat cache, reason grammar, reserved context keys. |
| `spec/FORMAT.md` | Store format v1: `tg.log` records, `graph_version`, `stat.cache`, `tg.lock`, compaction. |
| `spec/bindings-python.md` | Python binding notes. |
| `spec/CHANGE_REQUESTS.md` | Open change requests (CR-002 and CR-003 need human sign-off). |
| `spec/reference/` | General reference implementation used by conformance and fuzz. |
| `spec/schemas/` | JSON schemas for observations, changesets, plans, explanations. |
| `spec/validate.mjs` | Schema + reference policy validation. |

## Running validation

From the repo root (requires `make build` for the engine):

```sh
make check-spec   # schemas, reference policy, coverage matrix (PASS validate.mjs, PASS check-spec)
```

## Determinism

- Changes processed in ascending `(path, status, old_path)` order; input order never changes output.
- All plan lists sorted; reasons de-duplicated and sorted lexicographically; task IDs sorted by byte order (`spec/POLICY.md` section 5).

## Status

Spec conformance status: `status/SPEC_CONFORMANCE.json` (E1 verify — spec docs, 40 cases, general reference (34 query cases agree), coverage matrix, schemas checked against engine responses). Needs Spec sign-off.

Open items, including CR-002 and CR-003, are in `spec/CHANGE_REQUESTS.md` and `DECISIONS.md`. Full conformance suite: `conformance/` (40 cases C01–C40).

## Related

- `docs/PROTOCOL_SPEC.md`, `docs/POLICY_RULES.md`, `docs/DATA_MODEL.md`, `docs/STORE_FORMAT.md` — generated documentation mirrors of the spec
- `core/` — engine implementation of PROTOCOL/POLICY/FORMAT
- `bindings/` — clients implementing PROTOCOL
- `adapters/` — producers of observations and changesets
