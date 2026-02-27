# mcp.one — Phase A: Core Engine

> Focus: Build a rock-solid, hot-swappable MCP server that turns JSON configs into working API tools.

---

## Checklist

### Config Schema & Loader
- [ ] Define final `mcp.*.json` schema with nested body support (`body_template` or recursive params)
- [ ] Add `error_map` field to config schema for structured error surfacing
- [ ] Support default values for optional params
- [ ] Support all param locations: `body`, `path`, `query`, `header`
- [ ] Validate configs on load (schema validation, required fields, type checks)
- [ ] Loader reads all `mcp-configs/*.json` at startup

### Namespaced Tool Convention
- [ ] Implement `service.tool_name` naming convention (e.g. `github.create_issue`, `jira.get_issue`)
- [ ] Derive service prefix from config `id` field
- [ ] Ensure no collisions — error clearly if duplicates found across configs

### Authentication (All 4 types flawless)
- [ ] `bearer` — token from env var, `Authorization: Bearer <token>`
- [ ] `basic` — username + token from env vars, Base64 encoded
- [ ] `api_key` — key from env var, injected into configurable header
- [ ] `oauth2_static` — pre-acquired token from env var, same as bearer but semantically distinct
- [ ] Auth errors surfaced clearly (bad token, expired, missing env var)

### HTTP Executor
- [ ] Build HTTP requests from config (method, URL construction, headers, body)
- [ ] Path param interpolation (`/issue/{issue_id}`)
- [ ] Query string construction from `query` params
- [ ] Nested JSON body construction from config template
- [ ] Response mapping via JSONPath (`response_map`)
- [ ] Error mapping via JSONPath (`error_map`) — structured error output to LLM
- [ ] Support GET, POST, PUT, PATCH, DELETE

### Hot Reload
- [ ] File watcher on `mcp-configs/` directory
- [ ] Detect new config added — register tools dynamically
- [ ] Detect config modified — re-register tools with updated definition
- [ ] Detect config removed — unregister tools
- [ ] Zero downtime — no server restart, no connection drop
- [ ] Log config change events clearly

### System Config
- [ ] Define `mcp.system.json` (or similar) for global settings
- [ ] Per-service rate limit settings
- [ ] Adapter settings (Claude MCP spec vs others)
- [ ] Server-level controls (log verbosity, config directory path)

### Server & MCP Protocol
- [ ] MCP server entrypoint using official Anthropic MCP SDK (TypeScript)
- [ ] Dynamic tool registration from loaded configs
- [ ] Stdio transport support
- [ ] HTTP+SSE transport support
- [ ] Server logs: which URLs each tool connects to on startup
- [ ] Server logs: clear error output when a tool call fails (URL + status + error body)

### CLI
- [ ] `npx mcp-one start` — starts server with local `mcp-configs/`
- [ ] `--config <path>` flag to specify custom config directory
- [ ] Startup banner: list loaded configs, tool count, auth status

### Quality & Output
- [ ] JSON output to LLM is clean, well-structured, no junk
- [ ] Nested data (arrays, objects, tables) represented properly
- [ ] Error responses are structured and actionable, not raw dumps

### Distribution
- [ ] `package.json` configured for npx execution
- [ ] `.env.example` with all supported env var placeholders
- [ ] Sample configs: `mcp.github.json`, `mcp.jira.json`, `mcp.slack.json`
