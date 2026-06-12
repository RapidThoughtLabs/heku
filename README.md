# heku

> One server. Any API. Any LLM.

**heku** is a single dynamic [Model Context Protocol](https://modelcontextprotocol.io) server that turns JSON config files into working API tools. No code to write — drop a config, and your LLM gets the tools instantly.

Stop building one MCP server per API. Build one config.

---

## Try it now

**[console.rapidthoughtlabs.space](https://console.rapidthoughtlabs.space)** — hosted console you can point at any running heku instance. Connect, browse configs, chat with your tools, and inspect the system prompt — no local build needed.

**[app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)** — **heku hub**, the online registry for browsing, installing, and publishing heku configs. Find community-built connectors for GitHub, Slack, Linear, and more — or publish your own.

---

## Features

- **8 connector types** — 4 standard (HTTP, GraphQL, gRPC, child-MCP) + 4 experimental (CLI, File, SQL, MongoDB)
- **Hot-reload** — add or edit a config, tools update live without restart
- **Auto-discovery** — gRPC reflection, GraphQL introspection, and child MCP tool listing fill in tools automatically
- **Built-in console UI** — React dashboard for chat, config editing, and registry browsing
- **heku hub** — publish and install community configs from [app.rapidthoughtlabs.space](https://app.rapidthoughtlabs.space)
- **Auth handled** — bearer, basic, API key, and OAuth2 with `.env`-based credential management
- **Self-managing** — the server can create and edit its own configs via internal tools

---

## Install

Requires **Node.js ≥ 20**.

```bash
npx @rapidthoughtlabs/heku start
```

Or install globally:

```bash
npm install -g @rapidthoughtlabs/heku
heku start
```

---

## Quick start

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

Your LLM now has a `github-http.list_repos` tool.

---

## Connectors

Tool names follow the pattern `config_id.tool_name` — e.g. `github-http.list_repos`, `linear-graphql.create_issue`.

### Standard

#### `http` — REST API

Define each endpoint as a tool. Supports `path`, `query`, `body`, and `header` params.

```json
{
  "id": "stripe-http",
  "name": "Stripe",
  "connector": {
    "type": "http",
    "base_url": "https://api.stripe.com/v1",
    "auth": { "type": "bearer", "token_env": "STRIPE_API_KEY" }
  },
  "tools": [
    {
      "name": "list_customers",
      "description": "List Stripe customers with optional filters",
      "method": "GET",
      "path": "/customers",
      "params": [
        { "name": "limit",  "type": "number", "required": false, "location": "query", "description": "Max results (1–100)" },
        { "name": "email",  "type": "string", "required": false, "location": "query", "description": "Filter by email address" }
      ]
    },
    {
      "name": "create_customer",
      "description": "Create a new Stripe customer",
      "method": "POST",
      "path": "/customers",
      "params": [
        { "name": "email", "type": "string", "required": true,  "location": "body", "description": "Customer email" },
        { "name": "name",  "type": "string", "required": false, "location": "body", "description": "Full name" }
      ]
    }
  ]
}
```

**Tool fields:** `name`, `description`, `method` (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`), `path` (supports `{{param}}` placeholders), `params[]`, `body_template?`, `response_map?`, `error_map?`

**Param locations:** `path` · `query` · `body` · `header`

---

#### `graphql` — GraphQL API

Tools are auto-discovered via introspection. Set `tools: []`.

```json
{
  "id": "linear-graphql",
  "name": "Linear",
  "connector": {
    "type": "graphql",
    "endpoint": "https://api.linear.app/graphql",
    "auth": { "type": "bearer", "token_env": "LINEAR_API_KEY" },
    "include_mutations": true,
    "include_queries": true
  },
  "tools": []
}
```

**Connector fields:** `endpoint`, `auth?`, `introspect?` (default `true`), `include_mutations?` (default `true`), `include_queries?` (default `true`), `headers?`, `timeout_ms?`

---

#### `grpc` — gRPC service

Tools are auto-discovered via server reflection or a `.proto` file. Set `tools: []`.

```json
{
  "id": "myservice-grpc",
  "name": "My gRPC Service",
  "connector": {
    "type": "grpc",
    "endpoint": "localhost:50051",
    "reflection": true,
    "tls": false
  },
  "tools": []
}
```

Or with a proto file:

```json
{
  "connector": {
    "type": "grpc",
    "endpoint": "grpc.example.com:443",
    "proto_path": "./protos/service.proto",
    "tls": true,
    "auth": { "type": "bearer", "token_env": "GRPC_TOKEN" }
  }
}
```

**Connector fields:** `endpoint`, `reflection?` or `proto_path?` (one required), `tls?` (`true`/`false` or cert object), `auth?`, `metadata?`, `service_filter?`, `timeout_ms?`

---

#### `mcp` — child MCP server

Spawn any existing MCP server (stdio or SSE) and proxy its tools through heku. Tools are auto-discovered. Set `tools: []`.

```json
{
  "id": "filesystem-mcp",
  "name": "Filesystem MCP",
  "connector": {
    "type": "mcp",
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "install_command": "npm",
    "install_args": ["install", "-g", "@modelcontextprotocol/server-filesystem"]
  },
  "tools": []
}
```

SSE transport:

```json
{
  "connector": {
    "type": "mcp",
    "transport": "sse",
    "url": "http://localhost:8080/sse"
  }
}
```

**Connector fields:** `transport` (`stdio`/`sse`), `command?` + `args?` + `env?` (stdio), `url?` (sse), `install_command?`, `install_args?`, `install_cwd?`, `install_env?`, `install_timeout_ms?`, `active?`

> **Note:** `mcp` configs cannot be published to the registry — they reference local processes.

---

### Experimental

> These connector types are functional but their config schema and behaviour may change in future releases.

---

#### `cli` — shell command

Wrap any CLI tool as an MCP tool. Use `args_template` for positional args or `stdin_template` to pipe input.

```json
{
  "id": "git-cli",
  "name": "Git",
  "connector": { "type": "cli" },
  "tools": [
    {
      "name": "log",
      "description": "Show recent git commits",
      "args_template": ["git", "log", "--oneline", "-{{limit}}"],
      "params": [
        { "name": "limit", "type": "number", "required": false, "description": "Number of commits to show" }
      ],
      "output_as": "text"
    },
    {
      "name": "diff",
      "description": "Show unstaged changes",
      "command": "git diff",
      "params": [],
      "output_as": "text"
    }
  ]
}
```

**Tool fields:** `name`, `description`, `params[]`, `command?` (string) or `args_template?` (array), `stdin_template?`, `output_as?` (`"text"` | `"json"`)

---

#### `file` — filesystem

Read, write, append, delete, or list files. `path_template` supports `{{param}}` placeholders.

```json
{
  "id": "notes-file",
  "name": "Notes",
  "connector": { "type": "file" },
  "tools": [
    {
      "name": "read_note",
      "description": "Read a note by name",
      "operation": "read",
      "path_template": "/home/user/notes/{{name}}.md",
      "params": [
        { "name": "name", "type": "string", "required": true, "description": "Note filename without extension" }
      ]
    },
    {
      "name": "save_note",
      "description": "Save or overwrite a note",
      "operation": "write",
      "path_template": "/home/user/notes/{{name}}.md",
      "content_template": "{{content}}",
      "params": [
        { "name": "name",    "type": "string", "required": true, "description": "Note filename without extension" },
        { "name": "content", "type": "string", "required": true, "description": "Note content" }
      ]
    }
  ]
}
```

**Tool fields:** `name`, `description`, `params[]`, `operation` (`read`/`write`/`append`/`delete`/`list`), `path_template`, `content_template?` (required for `write`/`append`)

---

#### `sql` — relational database

Named SQL queries with `:param` placeholders. Supports PostgreSQL, MySQL, and SQLite.

```json
{
  "id": "analytics-sql",
  "name": "Analytics DB",
  "connector": {
    "type": "sql",
    "dialect": "postgres",
    "connection_string_env": "DATABASE_URL"
  },
  "tools": [
    {
      "name": "active_users",
      "description": "Count active users in a date range",
      "sql": "SELECT COUNT(*) as count FROM users WHERE created_at BETWEEN :from AND :to AND active = true",
      "params": [
        { "name": "from", "type": "string", "required": true, "description": "Start date (ISO 8601)" },
        { "name": "to",   "type": "string", "required": true, "description": "End date (ISO 8601)" }
      ],
      "max_rows": 1
    }
  ]
}
```

**Connector fields:** `dialect` (`postgres`/`mysql`/`sqlite`), `connection_string_env?` or field-based (`host`, `port`, `database`, `username_env`, `password_env`), `ssl?`, `pool_max?`

**Tool fields:** `name`, `description`, `params[]`, `sql` (`:name` placeholders only — no `{{}}`, no `?`, no `$N`), `max_rows?` (1–10000), `timeout_ms?`

---

#### `mongodb` — MongoDB

Document operations with JSON templates. Placeholders use `{{param}}` in templates.

```json
{
  "id": "catalog-mongo",
  "name": "Product Catalog",
  "connector": {
    "type": "mongodb",
    "database": "catalog",
    "connection_string_env": "MONGO_URI"
  },
  "tools": [
    {
      "name": "find_products",
      "description": "Search products by category and price range",
      "collection": "products",
      "operation": "find",
      "filter_template": { "category": "{{category}}", "price": { "$lte": "{{max_price}}" } },
      "params": [
        { "name": "category",  "type": "string", "required": true,  "description": "Product category" },
        { "name": "max_price", "type": "number", "required": false, "description": "Maximum price" }
      ],
      "max_rows": 50
    }
  ]
}
```

**Connector fields:** `database`, `connection_string_env?` or `host?`+`port?`, `auth_source?`, `tls?`

**Tool fields:** `name`, `description`, `params[]`, `collection`, `operation` (`find`/`findOne`/`aggregate`/`insertOne`/`insertMany`/`updateOne`/`updateMany`/`deleteOne`/`deleteMany`/`countDocuments`/`distinct`), plus operation-specific templates: `filter_template`, `update_template`, `document_template`, `documents_template`, `pipeline_template`, `projection?`, `sort?`, `max_rows?`, `limit?`, `timeout_ms?`

---

## Auth types

All credentials read from environment variables — `heku auth setup` writes them to `.env`:

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

---

## Tech stack

TypeScript · Node.js (ESM) · `@modelcontextprotocol/sdk` · Express · React 19 · Vite · Zustand · `@grpc/grpc-js` · GraphQL · tsup · Vitest

---

## Changelog

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

## License

Apache License 2.0 — see [LICENSE](LICENSE).
