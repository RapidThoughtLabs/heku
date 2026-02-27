# mcp.one — Phase B: Platform & Registry

> Focus: Build the mcp.one registry, user accounts, config discovery, and the sticky platform loop.

---

## Checklist

### User Accounts & Database (Supabase)
- [ ] Supabase project setup
- [ ] User auth — GitHub OAuth (primary), email/password (fallback)
- [ ] User profiles: username, namespace (e.g. `@ruchit`), avatar
- [ ] Personal config storage space — each user owns their published configs
- [ ] Supabase schema: `configs` table (id, namespace, slug, version, config_json, downloads, created_at, published_by)

### Registry API
- [ ] `GET /configs` — list/search published configs (by service, tool name, auth type)
- [ ] `GET /configs/:namespace/:id` — fetch a specific config
- [ ] `POST /configs/publish` — publish a config (authenticated)
- [ ] `GET /configs/:namespace/:id/versions` — list all versions of a config
- [ ] Semver versioning on published configs
- [ ] Download counter per config

### Publish Flow
- [ ] `ui/index.html` — visual config editor
- [ ] "Publish to mcp.one" button in editor UI
- [ ] Auth flow in UI (GitHub OAuth → Supabase session)
- [ ] Validation before publish (schema check, required fields)
- [ ] Namespace enforcement (only publish under your own namespace)

### Discovery & Pull
- [ ] Registry browsable at mcp.one website
- [ ] Search by service name, tool name, auth type, publisher
- [ ] `npx mcp-one pull @namespace/config-name` — download config to local `mcp-configs/`
- [ ] `npx mcp-one start --pull @ruchit/jira-cloud` — pull + start in one command
- [ ] Show download counts, version info in UI

### Trust & Verification
- [ ] Verified publisher badge system
- [ ] Link/URL verification on published configs
- [ ] Report mechanism for malicious configs
- [ ] Base URL validation — flag configs pointing to suspicious endpoints

### Theming & Branding
- [ ] RTL design system integration (JetBrains Mono, RTL:// branding)
- [ ] User-configurable theming for their namespace page
- [ ] Consistent with git.it and noteless RTL family look

### Platform Stickiness
- [ ] User dashboard — manage all your published configs in one place
- [ ] Config analytics (downloads, usage trends)
- [ ] Follow/star configs from other publishers
- [ ] Notification on config updates from followed publishers

### CLI Enhancements (Phase B)
- [ ] `mcp-one publish` — publish from CLI directly
- [ ] `mcp-one search <query>` — search registry from terminal
- [ ] `mcp-one pull <namespace/config>` — pull config locally
- [ ] `mcp-one list` — list locally installed configs
- [ ] `mcp-one update` — update pulled configs to latest versions

### Future Considerations (v2+)
- [ ] OAuth2 with refresh token flows
- [ ] OpenAPI auto-generation (`mcp-one generate --from openapi.yaml`)
- [ ] Webhooks and async/event-driven APIs
- [ ] Private org namespaces (Enterprise tier)
- [ ] Multi-step stateful workflows
