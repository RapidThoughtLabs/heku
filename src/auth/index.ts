import type { AuthConfig } from "../types.js";
import { resolveBearerAuth } from "./bearer.js";
import { resolveBasicAuth } from "./basic.js";
import { resolveApiKeyAuth } from "./api_key.js";
import { resolveOAuth2StaticAuth } from "./oauth2_static.js";

export function resolveAuth(auth: AuthConfig, configId: string): Record<string, string> {
  switch (auth.type) {
    case "bearer":
      return resolveBearerAuth(auth, configId);
    case "basic":
      return resolveBasicAuth(auth, configId);
    case "api_key":
      return resolveApiKeyAuth(auth, configId);
    case "oauth2_static":
      return resolveOAuth2StaticAuth(auth, configId);
  }
}

// ── Auth health check (no env reads, just presence check) ──────────
// Used by the CLI startup banner to show ✅ / ⚠️ per config.

import type { AuthConfig as AC } from "../types.js";

export function checkAuthEnvVars(auth: AC): string[] {
  const missing: string[] = [];
  switch (auth.type) {
    case "bearer":
    case "oauth2_static":
      if (!process.env[auth.token_env]) missing.push(auth.token_env);
      break;
    case "basic":
      if (!process.env[auth.username_env]) missing.push(auth.username_env);
      if (!process.env[auth.token_env]) missing.push(auth.token_env);
      break;
    case "api_key":
      if (!process.env[auth.key_env]) missing.push(auth.key_env);
      break;
  }
  return missing;
}
