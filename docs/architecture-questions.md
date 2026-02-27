# mcp.one Architecture Questions & Answers

## Config & Schema

### 1. Error Handling in response_map
**Q:** What happens when the API returns an error (4xx/5xx)? Do you want a separate `error_map` field, or will mcp.one just pass through the raw error body to the LLM?

**A:** Add an `error_map` field to the config schema. Debugging why a tool wasn't reaching the API (e.g. Zephyr) was painful without it. Errors need to be surfaced clearly — the LLM and the dev should both know exactly what went wrong and why.

---

### 2. Nested Body Structures
**Q:** Some APIs need nested body structures (Jira's `create_issue` actually needs `{"fields": {"summary": "...", "project": {"key": "..."}}}}`). Your current `params` schema is flat. Are you planning a `body_template` or some way to define nested JSON shapes in v1?

**A:** Yes, full nested JSON support is required — not optional. Flat params don't cut it. Even internal use cases (like connecting to a Postgres server) require nested structures to represent table data properly. The quality of JSON output to the LLM is a core product quality bar — this needs to be done right, not punted.

---

### 3. Default Values
**Q:** Do configs support default values for optional params? For example, `issue_type` defaulting to `"Task"` if the LLM doesn't provide one.

**A:** Yes — maximum user freedom. Go beyond just defaults: support any construct that gives the user control over param behavior without code. Think about what "freedom" means at the config level and implement it fully.

---

## Runtime & Server

### 4. Hot Reload
**Q:** Configs are loaded at startup — if someone drops a new JSON file into `mcp-configs/`, do they need to restart the server?

**A:** Absolutely no restarts. File watching is non-negotiable. Drop a config, it loads. Edit a config, it reloads. The server must be robust and always-on. Zero downtime, zero outages from config changes.

---

### 5. Tool Name Collisions / Namespacing
**Q:** With 50+ configs loaded, tool name collisions are inevitable. What's the namespacing strategy?

**A:** Invent a new method call convention. There's no rule that tool names have to be a single flat word. The convention should be:

```
github.create_issue()
jira.create_issue()
slack.send_message()
```

Service prefix + action name. Figure out the exact convention and implement it cleanly. This is a differentiator, not a detail.

---

### 6. Rate Limiting & Adapter Settings
**Q:** Any thoughts on per-config rate limit settings, or is that out of scope for v1?

**A:** This belongs in a dedicated **system config file** (separate from the per-service `mcp.*.json` files). This system config handles:
- Per-service rate limit settings
- Adapter/spec settings (e.g. Claude MCP spec vs OpenAI tool spec — whatever those differ on)
- Global server-level controls

The per-service configs stay clean. The system config handles cross-cutting concerns.

---

## Registry

### 7. Registry Auth & Publishing — Phase Split
**Q:** What's the auth for publishing? GitHub OAuth? Email/password? Anonymous?

**A:** Split into two phases:

**Phase A — Core engine, no registry auth needed:**
- All 4 auth types working flawlessly (bearer, basic, api_key, oauth2_static)
- High-quality JSON output to LLM
- Hot reload for configs
- Namespaced tool naming (`service.tool_name`)
- Hot-swappable MCP server configs

**Phase B — Platform & registry:**
- User accounts via Supabase
- Personal config storage space
- Theming & branding controls
- Full publish/discovery/pull flow
- Make the platform as sticky as possible

---

### 8. User-Specific Base URLs
**Q:** When pulling a config from the registry, `base_url` may be hardcoded. How do you handle user-specific URLs?

**A:** `base_url` stays in the `mcp.*.json` config — users set it themselves. But the server must log what URL each tool is actually calling so the dev can see it. If a tool errors, that error and the target URL must both be visible in server logs. No silent failures.

---

### 9. Trust & Verification
**Q:** Any plans for a trust/verification layer on registry configs?

**A:** Yes — planned for Phase B. Link verification is part of the Phase B registry work. Don't ship configs from unverified publishers without a trust signal.

---

## Distribution

### 10. Config Discovery via npx
**Q:** When running via `npx mcp-one start`, where does it look for configs? Does it pull from registry automatically?

**A:** Phase A: local `mcp-configs/` folder only. Users add configs manually. The goal for Phase A is a hot-swappable, always-on server. No registry integration yet.

Phase B: host the registry and connect it to the npx flow so users can pull configs by namespace directly.

---

## Deferred (Not Answered Yet)

### 11. OAuth2 Token Expiry
`oauth2_static` tokens will expire. v1 tells users to refresh manually. Revisit in v2 with full OAuth2 refresh flow.

### 12. OpenAPI Auto-Generation
Killer v2 feature. Not decided yet whether it lives in the CLI (`mcp-one generate --from openapi.yaml`) or the registry UI. Decide in Phase B planning.
