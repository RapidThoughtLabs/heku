# Connectors

Each connector type wraps a different kind of backend as MCP tools. Tool names follow the pattern `config_id.tool_name` — e.g. `github-http.list_repos`, `linear-graphql.create_issue`.

**Standard:** [`http`](#http) · [`graphql`](#graphql) · [`grpc`](#grpc) · [`mcp`](#mcp)
**Experimental:** [`cli`](#cli) · [`file`](#file) · [`sql`](#sql) · [`mongodb`](#mongodb)

> Experimental connectors are functional, but their config schema and behaviour may change in future releases.

---

## Standard

### `http`

REST API. Define each endpoint as a tool. Supports `path`, `query`, `body`, and `header` params.

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

### `graphql`

GraphQL API. Tools are auto-discovered via introspection. Set `tools: []`.

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

### `grpc`

gRPC service. Tools are auto-discovered via server reflection or a `.proto` file. Set `tools: []`.

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

### `mcp`

Child MCP server. Spawn any existing MCP server (stdio or SSE) and proxy its tools through heku. Tools are auto-discovered. Set `tools: []`.

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

## Experimental

> These connector types are functional but their config schema and behaviour may change in future releases.

### `cli`

Shell command. Wrap any CLI tool as an MCP tool. Use `args_template` for positional args or `stdin_template` to pipe input.

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

### `file`

Filesystem. Read, write, append, delete, or list files. `path_template` supports `{{param}}` placeholders.

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

### `sql`

Relational database. Named SQL queries with `:param` placeholders. Supports PostgreSQL, MySQL, and SQLite.

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

### `mongodb`

MongoDB. Document operations with JSON templates. Placeholders use `{{param}}` in templates.

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
