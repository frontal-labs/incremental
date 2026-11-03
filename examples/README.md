# Backplane Examples

Examples of using backplane: CLI workflows, adapter integrations, protocol clients, and CI recipes.

## Contents

This directory is a placeholder for example projects and recipes. Example ideas:

- A minimal repo demonstrating `backplane init` → `backplane serve` → `affected` over a small change set.
- A Vitest adapter integration (`adapters/vitest`) showing record → plan → skip unchanged tests.
- An MCP client driving `backplane-mcp` from an AI agent.
- A Python or Rust client script using the bindings in `bindings/python` and `bindings/rust`.

## Running examples

Most examples need the built engine:

```sh
make build
core/dist/backplane init --store .backplane
core/dist/backplane serve --store .backplane   # then speak Protocol v1 on stdio
```

## Contributing

Add example projects here, one subdirectory per example, each with its own README explaining what it demonstrates and how to run it. See `docs/DEVELOPMENT_GUIDE.md` for contribution ground rules and `docs/CONFORMANCE_AND_TESTING.md` for testing conventions.
