# Incremental Examples

Examples of using incremental: CLI workflows, adapter integrations, protocol clients, and CI recipes.

Per §12.4 M8 and §1180, the `examples/` directory is owned by the Adapters role and includes an `agent_loop` example. Per `docs/adapters/ADAPTERS.md`, examples demonstrate the adapter loop contract (section 10.4).

## Example Projects

| Example                            | Description                                                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| [cli_workflow/](cli_workflow/)     | Minimal repo demonstrating `incremental init` → `incremental serve` → `affected` over a small change set.                            |
| [agent_loop/](agent_loop/)         | M8 benchmark: agent loop (edit → plan → run → time) with 1, 5 and 20 agents sharing one store. Target: >= 2x faster than full suite. |
| [vitest_adapter/](vitest_adapter/) | Vitest adapter integration: record → plan → skip unchanged tests.                                                                    |
| [mcp_client/](mcp_client/)         | MCP client driving `incremental-mcp` from an AI agent (Python + TypeScript).                                                         |
| [python_client/](python_client/)   | Python client (`incremental` package) speaking Protocol v1 over stdio.                                                               |
| [rust_client/](rust_client/)       | Rust client (`incremental-rust` crate) speaking Protocol v1 over stdio.                                                              |
| [ci_recipe/](ci_recipe/)           | CI recipes: GitHub Actions workflow, local CI script, Dockerfile for Linux gate.                                                     |

## Running Examples

Most examples need the built engine:

```sh
make build
core/dist/incremental init --store .incremental
core/dist/incremental serve --store .incremental   # then speak Protocol v1 on stdio
```

## Contributing

Add example projects here, one subdirectory per example, each with its own README explaining what it demonstrates and how to run it. See `docs/development/DEVELOPMENT_GUIDE.md` for contribution ground rules and `docs/conformance/CONFORMANCE_AND_TESTING.md` for testing conventions.

## Reference

- `docs/adapters/ADAPTERS.md` — adapter types, recorder contract, adapter loop contract.
- `docs/spec/PROTOCOL.md` — incremental Protocol v1.
- `docs/spec/POLICY.md` — policy rules P0–P11.
- `` — full specification v4.1 (sections 10–11 for adapters, 12.4 for benchmarks).
