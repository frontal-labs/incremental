# Incremental Docker

Docker definition for the Linux gate check (PLAN 17.1 `linux-gate`): running the full incremental test target on linux/amd64.

## Contents

| Path | Description |
|---|---|
| `docker/Dockerfile.linux` | Builds and runs the test target: Node 22 bookworm, git/python3/make/curl/build-essential, the released Goose linux-x64 binary, then `make all-tests test-python test-git test-fuzz`. |

## Running

```sh
make linux-gate
```

This runs:

```sh
docker build --no-cache --platform linux/amd64 -f docker/Dockerfile.linux -t incremental:linux .
docker run --rm --platform linux/amd64 incremental:linux make all-tests test-python test-git test-fuzz
```

Output is captured in `core/dist/linux-gate.log`.

## Deviation

The container runs the released Goose linux-x64 binary under amd64 emulation. Goose has no linux-arm64 release, and building Goose from source is not documented in the release, so it is not done here. This deviation is recorded in DECISIONS.md. The Dockerfile is also referenced by `.dockerignore`.

## Status

The `linux-gate` target is not part of `all-tests`; it is run separately (e.g. in CI). See `STATUS.md` for current gate status (Linux container run failed only from the `.dockerignore` rule, now fixed; rerun pending).
