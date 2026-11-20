# Incremental Node.js Binding

## Engine binary

`@incremental/client` depends on `@incremental/engine`, which bundles the engine
prebuild for each platform. `defaultEngine()` finds the engine in this order:
`$INCREMENTAL_ENGINE`, the bundled prebuild, then `<repo>/core/dist/incremental`.
