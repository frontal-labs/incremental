# Backplane Schemas

JSON schemas for backplane: observations, changesets, plans, explanations, and store records. Schemas are the machine-readable counterpart to `spec/PROTOCOL.md`, `spec/POLICY.md` and `spec/FORMAT.md`.

## Contents

| Path | Description |
|---|---|
| `schemas/` | Schema files (currently a placeholder: `.gitkeep`). Authoritative schema material also lives in `spec/schemas/`. |

## Related

- `spec/PROTOCOL.md` — Protocol v1 observation, ChangeSet and Plan schemas (sections 9.5–9.6).
- `spec/POLICY.md` — plan semantics: reasons, fallbacks, confidence (section 4).
- `spec/FORMAT.md` — store format v1: `tg.log` records, `graph_version`, `stat.cache`, `tg.lock` (sections 6, 7.4, 7.6).
- `spec/schemas/` — schema artifacts checked by `spec/validate.mjs`.
- `spec/validate.mjs` — schema + reference policy validation, run via `make check-spec`.
- `docs/DATA_MODEL.md` — core concepts and observation/ChangeSet schemas.

## Validating

From the repo root:

```sh
make check-spec   # schemas, reference policy, coverage matrix
```

## Status

Schema conformance is part of E1 verify (spec conformance): see `status/SPEC_CONFORMANCE.json` and `STATUS.md`.
