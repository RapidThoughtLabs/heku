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
- **Azure OpenAI support** — when the custom Base URL points at
  `*.openai.azure.com`, the Console auto-switches to Azure's wire format
  (deployment-in-path URL, `api-key` header, and the required `?api-version=`
  query param) and surfaces an editable **API version** field. The model field
  is your **deployment name**. Defaults to api-version `2024-12-01-preview`.

### Fixed
- o-series reasoning models (o1/o3/o4) now send `max_completion_tokens` instead
  of `max_tokens`, which those models reject.

## [0.3.2] - 2026-06-22

Baseline — Console history before this point is tracked in the root
[`CHANGELOG.md`](../CHANGELOG.md) and the **Changelog** section of the
[`README.md`](../README.md).
