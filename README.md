# heku

![heku — one brain, eight connectors](https://raw.githubusercontent.com/RapidThoughtLabs/heku/main/.github/assets/banner.png)

> One server. Any API. Any LLM.

**Your agent's tool manifest breaks around ten MCP servers.** Every server you add fattens the manifest until the context fills up and the model starts forgetting which tools exist. heku is one [MCP](https://modelcontextprotocol.io) server that removes that ceiling: you describe each tool as a JSON config, and heku serves them *lazily* — the manifest stays a few hundred tokens whether you've loaded ten configs or two hundred, and the model pulls in only the tools it needs, when it needs them.

One server, any number of APIs, no context bloat. Agents can even write their own configs live from API docs.

```bash
npx @rapidthoughtlabs/heku start
```

**[Website](https://www.rapidthoughtlabs.com/products/heku)** · **[Launch post →](https://www.rapidthoughtlabs.com/blog/heku-dynamic-tooling)** · **[Console](https://console.rapidthoughtlabs.space)** · **[heku hub](https://app.rapidthoughtlabs.space)**

---

## Try it now

**[console.rapidthoughtlabs.space](https://console.rapidthoughtlabs.space)** — hosted console you can point at any running heku instance. Connect, browse configs, chat with your tools, and inspect the system prompt — no local build needed.

**[app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)** — **heku hub**, the online registry for browsing, installing, and publishing heku configs. Find community-built connectors for GitHub, Slack, Linear, and more — or publish your own.

---

## Quick start

Install (requires **Node.js ≥ 20**):

```bash
npx @rapidthoughtlabs/heku start
# or: npm install -g @rapidthoughtlabs/heku && heku start
```

Create `mcp-configs/mcp.github.json`:

```json
{
  "id": "github-http",
  "name": "GitHub API",
  "description": "Manage GitHub repos, issues, and pull requests",
  "connector": {
    "type": "http",
    "base_url": "https://api.github.com",
    "auth": { "type": "bearer", "token_env": "GITHUB_TOKEN" }
  },
  "tools": [
    {
      "name": "list_repos",
      "description": "List repositories for the authenticated user",
      "method": "GET",
      "path": "/user/repos",
      "params": [
        { "name": "per_page", "type": "number", "required": false, "location": "query", "description": "Results per page" }
      ]
    }
  ]
}
```

```bash
heku auth setup github-http   # writes GITHUB_TOKEN to .env
heku start
```

Your LLM now has a `github-http.list_repos` tool — and the manifest grew by only that one entry.

---

## How it works

heku sits between your LLM and every API you've configured. Three ideas make it different from running a pile of separate MCP servers:

- **Lazy discovery.** The manifest the model sees stays small no matter how many configs you load. Tools are surfaced on demand instead of dumped up front, so you never hit the ~ten-server context wall.
- **Configs, not code.** A tool is a JSON file — an endpoint, its params, and how to authenticate. No per-integration server to build, ship, or maintain.
- **Self-managing.** Point heku at API docs and it can author and edit its own configs through internal tools, then hot-reload them without a restart.

Tool names follow the pattern `config_id.tool_name` — e.g. `github-http.list_repos`, `linear-graphql.create_issue`.

---

## Features

- **8 connector types** — 4 standard (HTTP, GraphQL, gRPC, child-MCP) + 4 experimental (CLI, File, SQL, MongoDB)
- **Lazy tool discovery** — manifest stays a few hundred tokens regardless of how many configs are loaded
- **Hot-reload** — add or edit a config, tools update live without restart
- **Auto-discovery** — gRPC reflection, GraphQL introspection, and child MCP tool listing fill in tools automatically
- **Response stripping** — base64 blobs, null fields, oversized strings, and long arrays are trimmed before the model sees them, keeping context lean without losing data
- **Built-in console UI** — React dashboard for chat, config editing, and registry browsing
- **heku hub** — publish and install community configs from [app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)
- **Auth handled** — bearer, basic, API key, and OAuth2 with `.env`-based credential management
- **Self-managing** — the server can create and edit its own configs via internal tools

---

## Connectors

Each connector type wraps a different kind of backend as MCP tools. Full config schemas, field references, and examples live in **[connectors.md](connectors.md)**.

| Connector | Status | What it wraps | Tool discovery |
|-----------|--------|---------------|----------------|
| [`http`](connectors.md#http) | standard | REST APIs | manual (define each endpoint) |
| [`graphql`](connectors.md#graphql) | standard | GraphQL APIs | auto (introspection) |
| [`grpc`](connectors.md#grpc) | standard | gRPC services | auto (reflection / `.proto`) |
| [`mcp`](connectors.md#mcp) | standard | existing MCP servers | auto (proxied) |
| [`cli`](connectors.md#cli) | experimental | shell commands | manual |
| [`file`](connectors.md#file) | experimental | filesystem read/write | manual |
| [`sql`](connectors.md#sql) | experimental | Postgres / MySQL / SQLite | manual (named queries) |
| [`mongodb`](connectors.md#mongodb) | experimental | MongoDB | manual (document ops) |

> Experimental connectors are functional, but their config schema and behaviour may change in future releases.

---

## Auth

All credentials read from environment variables — `heku auth setup` writes them to `.env`, and nothing ever travels over the MCP protocol.

| Type | Header |
|---|---|
| `bearer` | `Authorization: Bearer {token}` |
| `basic` | `Authorization: Basic base64(user:token)` |
| `api_key` | Custom header, e.g. `X-API-Key` |
| `oauth2_static` | Pre-acquired OAuth2 access token |

```json
{ "type": "bearer",       "token_env": "GITHUB_TOKEN" }
{ "type": "api_key",      "key_env": "MY_KEY", "header_name": "X-Api-Key" }
{ "type": "basic",        "username_env": "MY_USER", "token_env": "MY_PASS" }
{ "type": "oauth2_static","token_env": "MY_OAUTH_TOKEN" }
```

---

## CLI commands

```text
heku start [config-dir]      Start the MCP server (stdio by default)
                             Flags: --http, --port <n>, --debug

heku list [service]          List loaded configs + auth status
heku auth                    Check or set up credentials interactively
heku auth status             Show per-service auth health
heku auth setup [service]    Walk through env-var setup, write to .env

heku login                   Authenticate with the registry
heku logout                  Clear stored registry credentials

heku install <target>        Install a config from the registry
                             Target: @ns/slug or @ns/slug@version
heku uninstall <target>      Remove an installed registry config
heku publish [file]          Publish a local config to the registry
heku fork <namespace/slug>   Fork a published config into your namespace

heku discover                Scan Claude Desktop / Cursor for MCP servers
heku update                  Update heku to the latest version
heku help                    Show usage
```

Start with the console UI:

```bash
heku start --http --port 3456
```

Then open **[console.rapidthoughtlabs.space](https://console.rapidthoughtlabs.space)** and connect to `http://localhost:3456`.

---

## Console UI

The dashboard is a React + Vite app — available hosted at **[console.rapidthoughtlabs.space](https://console.rapidthoughtlabs.space)** or embedded when you run `heku start --http`.

- **Chat** — test tools through a model of your choice (OpenAI, Together AI)
- **Configs** — visual editor for connector and tool definitions
- **Prompts** — inspect the system prompt layers and token counts
- **Registry** — browse, install, and publish configs
- **Auth** — credential status across all configs at a glance

---

## heku hub

**[app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)** is the default registry for sharing configs — browse community connectors, install with one command, and publish your own.

```bash
heku install @rtl/github
heku install @rtl/slack@1.2.0
heku publish mcp-configs/mcp.stripe-http.json
```

Use `--registry <url>` to point at a self-hosted registry.

---

## System config (optional)

Drop `heku.config.json` in your config directory:

```json
{
  "log_level": "info",
  "rate_limits": {
    "github-http": { "requests_per_minute": 60 }
  },
  "self_config": true
}
```

---

## Development

```bash
git clone https://github.com/RapidThoughtLabs/heku
cd heku
npm install

npm run dev          # client (5173) + console server (3456) in parallel
npm run dev:mcp      # MCP stdio server only — for testing with Claude Desktop
npm run build        # bundle CLI to dist/cli.js via tsup
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

### Layout

```
src/             MCP server core (CLI, connectors, auth, loader, executor)
server/          Express backend for the console UI
client/          React + Vite dashboard
protos/          Example .proto files for gRPC connector testing
scripts/         Registry seed scripts
mcp-configs/     Local config files (gitignored)
```

### Tech stack

TypeScript · Node.js (ESM) · `@modelcontextprotocol/sdk` · Express · React 19 · Vite · Zustand · `@grpc/grpc-js` · GraphQL · tsup · Vitest

---

## Changelog

> Console (UI) changes are tracked separately in [`client/CHANGELOG.md`](client/CHANGELOG.md).

### 0.3.2
- **Response stripping** — every tool response is structurally trimmed before it reaches the model. Base64 blobs become size markers, null/empty fields are dropped, strings over 8 000 chars are head-truncated, and arrays over 100 items are capped. Structure-only — never decides which field matters.

### 0.3.1
- Renamed meta-tool namespace from `mcp.one.*` to `heku.*` across all connectors, prompts, and client code
- Fixed deployed console manifest style switcher (settings API calls now use the correct bridge base URL)
- Fixed prompt page config catalog not refreshing when heku connects after page load
- Markdown rendering in the demo chat — assistant responses now render formatted text
- Config catalog descriptions now show in composed prompt preview; falls back to display name when description is absent
- Dual manifest preview in Prompts page — flat and namespaced styles with separate token counts
- heku server version now reads from `package.json` at runtime in dev mode instead of showing `0.0.0-dev`

### 0.3.0
- Registry versioning overhaul — semver-based publish/install flow
- CLI registry commands: `install`, `uninstall`, `fork`, `publish`
- Console registry browser tab

### 0.2.x
- SQL and MongoDB connector types (experimental)
- Config write lock — block LLM agents from mutating configs
- Hot-reload watcher improvements

---

## Contributors

- [@ruchitnannavare](https://github.com/ruchitnannavare) — creator & maintainer
- [@SayanSwaroopROy](https://github.com/SayanSwaroopROy)

---

## License

Apache License 2.0 — see [LICENSE](LICENSE).
