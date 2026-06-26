# Console Changelog

All notable changes to the heku **Console** — the `client/` dashboard and API
bridge — are documented here. The running Console version is shown in
**Settings → About**.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Custom LLM provider** — alongside OpenAI and Together AI you can now add a
  custom OpenAI-spec inference endpoint. Set an editable **Base URL** and API
  token in the connect dialog (and in **Settings → LLM**), then add deployment
  models through the existing **Custom models** list. The base URL persists
  locally; the token stays in session memory only and is never written to disk.

## [0.3.2] - 2026-06-22

Baseline — Console history before this point is tracked in the root
[`CHANGELOG.md`](../CHANGELOG.md) and the **Changelog** section of the
[`README.md`](../README.md).
