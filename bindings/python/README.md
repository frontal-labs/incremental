# Incremental Python Binding

## Engine binary

`connect()` finds the engine in this order: `$INCREMENTAL_ENGINE`, the prebuild
bundled for this platform (`incremental_client/prebuilds/<platform>-<arch>/`),
then `<repo>/core/dist/incremental`.

Wheels carry one engine prebuild each. Build the engine for the target first
(`packages/engine/scripts/build-prebuilds.mjs`), then:

    python scripts/build_wheel.py --target darwin-arm64 --outdir dist
