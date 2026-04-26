import type { ApiKeyAuth } from "../types.js";
import { AuthNotConfiguredError } from "./errors.js";

export function resolveApiKeyAuth(auth: ApiKeyAuth, configId: string): Record<string, string> {
  const key = process.env[auth.key_env];
  if (!key) {
    throw new AuthNotConfiguredError(configId, "api_key", [auth.key_env]);
  }
  return { [auth.header_name]: key };
}
