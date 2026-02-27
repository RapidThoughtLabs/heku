# mcp.one — Phase A Implementation Plan (High Level)

> Get from zero to a working, hot-swappable MCP server that any dev can `npx` and use.

---

## Step 1: Project Scaffold
- Init Node.js/TypeScript project
- Set up `tsconfig.json`, `package.json` (with `bin` for `mcp-one` CLI)
- Install dependencies: `@modelcontextprotocol/sdk`, `jsonpath-plus`, `chokidar` (file watching), `dotenv`
- Create directory structure:
  ```
  src/
    server.ts
    loader.ts
    executor.ts
    auth/
      bearer.ts
      basic.ts
      api_key.ts
      oauth2_static.ts
  mcp-configs/
  ```
- Add `.env.example` with placeholder vars

## Step 2: Config Schema & Loader (`src/loader.ts`)
- Define the TypeScript types for the config schema
- Support nested body via `body_template` (JSON object with `{{param}}` interpolation) alongside flat `params`
- Add `error_map` field (JSONPath mappings for error responses)
- Add `default` field on params
- Glob `mcp-configs/mcp.*.json`, parse, validate each
- Return an array of validated config objects ready for registration
- Fail loud on bad configs — log exactly what's wrong and which file

## Step 3: Auth Module (`src/auth/`)
- Each auth type is a function: `(config.auth, env) → headers`
- `bearer.ts`: reads `token_env` from env, returns `Authorization: Bearer <token>`
- `basic.ts`: reads `username_env` + `token_env`, Base64 encodes, returns `Authorization: Basic <encoded>`
- `api_key.ts`: reads `key_env`, injects into `header_name`
- `oauth2_static.ts`: same as bearer mechanically, distinct type for future expansion
- All auth functions validate env vars exist — throw clear error if missing

## Step 4: HTTP Executor (`src/executor.ts`)
- Takes a tool call (tool config + params from LLM) and produces an HTTP request
- Path interpolation: replace `{param}` in URL path
- Query string: collect `query` params, append to URL
- Body: if `body_template` exists, interpolate params into nested structure; otherwise build flat JSON from `body` params
- Attach auth headers from Step 3
- Execute request (native `fetch` or `undici`)
- On success: apply `response_map` (JSONPath) to response body, return clean JSON to LLM
- On error (4xx/5xx): apply `error_map` if defined, return structured error with status code, URL called, and mapped error fields
- Log every request: method, URL, status code (at minimum)

## Step 5: MCP Server & Dynamic Registration (`src/server.ts`)
- Initialize MCP server using `@modelcontextprotocol/sdk`
- Load configs via loader (Step 2)
- For each config, for each tool: register as MCP tool
- Tool name format: `{config.id}.{tool.name}` (e.g. `github.create_issue`)
- Tool description: from config `tool.description`
- Tool input schema: derived from `params` array (name, type, required, description)
- Tool handler: calls executor (Step 4) with the tool config + LLM-provided params
- Support stdio transport (primary for Claude Desktop)
- Support HTTP+SSE transport (for remote/web clients)
- Startup log: list every loaded config, every registered tool, and the base URL each config points to

## Step 6: Hot Reload
- Use `chokidar` to watch `mcp-configs/` directory
- On file add: load config, validate, register new tools
- On file change: unregister old tools for that config, re-register with updated config
- On file delete: unregister tools for that config
- Log every change event with config name and what happened
- No server restart, no client disconnect — tools update in place

## Step 7: System Config
- Define `mcp.system.json` (or `system.config.json`) schema
- Rate limits: per-service max requests/minute
- Adapter settings: spec mode (Claude MCP vs future adapters)
- Server settings: log level, config directory override
- Loaded once at startup, hot-reloadable same as service configs

## Step 8: CLI Entrypoint
- `bin` entry in `package.json` → `mcp-one`
- `mcp-one start` — default command, starts server
- `--config <path>` — override config directory (default: `./mcp-configs`)
- Startup banner: project name, loaded config count, tool count, base URLs
- Clean shutdown on SIGINT/SIGTERM

## Step 9: Sample Configs & Testing
- Write 3 sample configs: `mcp.github.json`, `mcp.jira.json`, `mcp.slack.json`
- Each demonstrates: different auth types, nested bodies, error maps, response maps
- Manual integration test: connect to Claude Desktop, call tools, verify responses
- Unit tests for: loader validation, auth header generation, executor request building, response/error mapping

## Step 10: Package & Ship
- Set `package.json` for npm publish (`mcp-one`)
- Ensure `npx mcp-one start` works out of the box
- Write README with: quick start, config format, auth setup, Claude Desktop config snippet
- Tag `v0.1.0` — Phase A complete

---

## Build Order Summary

```
Step 1  →  Scaffold
Step 2  →  Loader (configs in, typed objects out)
Step 3  →  Auth (env vars in, headers out)
Step 4  →  Executor (tool call in, HTTP response out)
Step 5  →  Server (wire it all together, expose MCP tools)
Step 6  →  Hot Reload (file watcher, live tool updates)
Step 7  →  System Config (rate limits, adapter settings)
Step 8  →  CLI (npx entrypoint, flags, banner)
Step 9  →  Samples & Tests
Step 10 →  Package & Ship
```

Each step is buildable and testable independently. Steps 2-4 are the core pipeline. Step 5 integrates them. Steps 6-8 are enhancements. Steps 9-10 are polish and release.
