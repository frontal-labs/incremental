# Incremental Rust Binding

## Engine binary

`Config::default()` finds the engine in this order: `$INCREMENTAL_ENGINE`, the
prebuild under `packages/engine/prebuilds/<platform>-<arch>/`, then
`core/dist/incremental`. The same order is used by the Node and Python clients.
