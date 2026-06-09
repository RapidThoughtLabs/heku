# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/RapidThoughtLabs/heku/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/RapidThoughtLabs/heku/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/RapidThoughtLabs/heku/compare/v0.1.0...v0.1.2
[0.1.0]: https://github.com/RapidThoughtLabs/heku/releases/tag/v0.1.0
