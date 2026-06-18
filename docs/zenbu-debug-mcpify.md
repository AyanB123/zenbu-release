# Zenbu MCPify Debug Harness

This project exposes a local MCPify configuration at `mcp/zenbu-debug.mcpify.json`.
It wraps `scripts/debug/zenbu_debug_tool.py`, which can launch Zenbu, inspect the CDP endpoint, tail logs, and summarize boot traces.

## Local Commands

```powershell
pnpm run debug:launch
pnpm run debug:cdp
python -m mcpify validate mcp/zenbu-debug.mcpify.json --verbose
python -m mcpify serve mcp/zenbu-debug.mcpify.json
python -m mcpify serve mcp/zenbu-debug.mcpify.json --mode streamable-http --port 8787
```

## Codex MCP Config

Codex loads MCP servers at session startup. Add this server to the Codex config, then restart or reload the Codex session:

```toml
[mcp_servers.zenbu-debug]
command = "python"
args = ["-m", "mcpify", "serve", "/path/to/zenbu-release/mcp/zenbu-debug.mcpify.json"]
startup_timeout_sec = 30
```

## Notes

- `launch_debug` disables Dynohot/HMR by default through `ZENBU_DISABLE_DYNOHOT=1`; pass `enable_hmr=true` only when testing HMR behavior.
- CDP defaults to `http://127.0.0.1:9222`.
- Debug logs are written to `.zenbu/logs/debug/`.
- Boot traces are written to `traces/boot/` and copied by startup probes into `.zenbu/logs/perf/`.
