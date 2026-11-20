# Incremental Python Binding (`incremental-client`)

Protocol v1 client for Python 3.10 and later, using only the standard library. The import name is `incremental_client`.

## Install

The package is not on PyPI yet. Build a wheel for your platform from the repo and install it:

```sh
python scripts/build_wheel.py --target darwin-arm64 --outdir dist
pip install dist/incremental_client-*-macosx_11_0_arm64.whl
```

Each wheel carries one engine prebuild. Build the engine for the target first (`packages/engine/scripts/build-prebuilds.mjs`). Targets: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`.

## Usage

Create the store once with the engine before connecting:

```sh
$INCREMENTAL_ENGINE init --store .incremental
```

```python
import incremental_client

client = incremental_client.connect(store=".incremental")
print(client.hello())   # engine version, protocol, capabilities
print(client.stats())
client.close()
```

`connect` takes `store` (default `$INCREMENTAL_STORE`, then `<repo>/.incremental`), `engine` (a path or command prefix), `root`, `timeout` (default 10 seconds), and `restart` (default `True`).

## Layout

- `incremental_client/client.py`: `connect` and the `Incremental` client
- `incremental_client/_transport.py`: engine process, line protocol, engine lookup
- `incremental_client/errors.py`: `IncrementalError`
- `incremental_client/prebuilds/`: the engine prebuild, staged when a wheel is built
- `scripts/build_wheel.py`: builds one platform wheel
- `tests/`: conformance, parity, and resilience tests

## Engine binary

`connect()` finds the engine in this order: `$INCREMENTAL_ENGINE`, the prebuild bundled for this platform (`incremental_client/prebuilds/<platform>-<arch>/`), then `<repo>/core/dist/incremental`.

## Tests

```sh
cd bindings/python && python3 -m unittest discover -s tests -t .   # or `make test-python`
```
