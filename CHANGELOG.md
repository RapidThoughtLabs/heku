# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.2] - 2026-06-22

### Added
- **Response stripping** — every tool response is now structurally trimmed before it reaches the model. Removes base64 blobs, null/empty fields, oversized strings, and long arrays so the model receives a clean, compact payload instead of raw upstream noise. Fully transparent: stripping is idempotent and structure-only — it never decides which field matters.
  - Base64 blobs / `data:` URIs → replaced with `{ _heku: "binary-omitted", bytes }` marker
  - `null` / `undefined` / `[]` / `{}` → dropped silently
  - Strings over 8 000 chars → first 512 chars kept, remainder replaced with `⟦heku: +N chars truncated⟧`
  - Arrays over 100 items → first 100 kept, `{ _heku: "array-truncated", shown, total }` appended

## [0.3.1] - 2026-06-15

### Changed
- Renamed internal tool namespace from `one.*` to `heku.*` everywhere — tool names, descriptions, and search hints now consistently use `heku.search`, `heku.invoke`, etc.
- Console settings panel fixes and polish.
- Dual manifest preview in the console (flat vs. namespaced mode).

## [0.3.0] - 2026-06-11

### Added
- **`heku update`** now updates registry-installed configs to their latest versions (instead of updating the heku binary). Accepts an optional target: `heku update github-http`, `heku update linear:graphql`, or `heku update @ns/linear` (all connector variants). Local credentials (`connector.env`) and overlays are preserved on update.
- **`one.registry_update`** MCP tool — same update logic callable by an LLM agent. Updates one config by `config_id` or all installed configs when no argument is passed.
- **`one.list_configs`** now returns `[{ id, name, description }]` objects instead of a flat array of IDs, so agents can identify the right config without an extra round-trip.

### Changed
- Publish modal always shows the version field. New (unpublished) configs show an empty field with a "not published yet" hint; existing configs are pre-filled with the next patch version and show the current published version as a hint.
- Flat manifest (`search`, `list_configs`, `list_tools`, `invoke`) no longer prefixes tool descriptions with `[one]` — it was noise when only four tools are shown. Namespaced mode is unchanged.
- Discovery tool descriptions updated with explicit workflow steps and call examples for users without custom system prompts.

## [0.2.0] - 2026-06-09

### Changed
- **Renamed** the project from `mcp.one` / `@rapidthoughtlabs/mcpone` to **heku** / `@rapidthoughtlabs/heku`.
- CLI binary is now `heku` (was `mcpone`). All commands follow: `heku start`, `heku install`, etc.
- State directory moved from `~/.mcp-one/` to `~/.heku/` (clean break — re-run `heku login` to restore credentials).
- System config file renamed from `mcp-one.config.json` to `heku.config.json`.
- `MCP_ONE_STATE_DIR` env var renamed to `HEKU_STATE_DIR`.
- `MCP_ONE_TOKEN` env var renamed to `HEKU_TOKEN`.
- MCP config file convention (`mcp.*.json`, `mcp.one.json`), tool namespace (`one.*`), and config directory (`mcp-configs/`) are **unchanged**.

## [0.1.2] - 2026-06-07

### Changed
- Renamed the CLI command from `mcp-one` to `mcpone` so it matches the npm
  package name (`@rapidthoughtlabs/mcpone`) everywhere — binary, help text,
  and all command hints.

### Fixed
- Published build now includes the compiled `dist/`, so `npx @rapidthoughtlabs/mcpone`
  and global installs run the latest binary instead of failing to resolve it.

## [0.1.0] - 2026-06-07

### Added
- Initial public release on npm as `@rapidthoughtlabs/mcpone`.
- Single dynamic MCP server that turns JSON configs into working API tools.

[Unreleased]: https://github.com/RapidThoughtLabs/heku/compare/v0.3.2...HEAD
[0.3.2]: https://github.com/RapidThoughtLabs/heku/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/RapidThoughtLabs/heku/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/RapidThoughtLabs/heku/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/RapidThoughtLabs/heku/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/RapidThoughtLabs/heku/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/RapidThoughtLabs/heku/releases/tag/v0.1.0
