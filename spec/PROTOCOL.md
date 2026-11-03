# Affectra Protocol v1

See PLAN.md §9 for normative behavior.

## Transport
- JSON Lines over stdio, one object per line, flushed per line.
- Requests have integer `id`. Responses echo `id`.
- Exactly one of `result` or `error` per response.
- Malformed line → `invalid_params` with `id: null`, loop continues.

## Handshake
- `hello` must be first. Client sends `{protocol:1, client:{name,version}}`. Server replies `{protocol:1, engine:{name,version}, capabilities:[...], store:".affectra"}` or `protocol_mismatch`.

## Methods
See PLAN.md §9.3.
