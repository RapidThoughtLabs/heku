import fs from "node:fs";
import path from "node:path";
import { isEncrypted, decryptWithKeyring } from "./secrets/crypto.js";
import { getCachedKeyring, refreshKeyring } from "./secrets/master-key.js";

const configEnv = new Map<string, Map<string, string>>();

interface ParseResult {
  map: Map<string, string>;
  /** Keys whose value was `enc:v1:` but failed to decrypt against every key in the keyring. */
  failed: string[];
}

function parseEnvContent(content: string, configId: string): ParseResult {
  const map = new Map<string, string>();
  const failed: string[] = [];
  const keyring = getCachedKeyring();

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawVal = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    if (!key) continue;

    if (isEncrypted(rawVal)) {
      if (!keyring) {
        failed.push(key);
        continue;
      }
      try {
        map.set(key, decryptWithKeyring(keyring, rawVal, `${configId}:${key}`));
      } catch {
        failed.push(key);
      }
    } else {
      map.set(key, rawVal);
    }
  }

  return { map, failed };
}

/**
 * Load a per-config env file into the in-memory store. Returns count of vars loaded.
 * `enc:v1:` values are decrypted with the cached keyring; on a decrypt miss the
 * keyring is refreshed once (another instance may have rotated it, §12.1) and the
 * file is re-parsed before committing. Values that still fail are skipped, not
 * fatal — the rest of the file loads normally.
 */
export async function loadConfigEnv(configId: string, filePath: string): Promise<number> {
  if (!fs.existsSync(filePath)) {
    configEnv.delete(configId);
    return 0;
  }
  const content = fs.readFileSync(filePath, "utf-8");
  let { map, failed } = parseEnvContent(content, configId);

  if (failed.length > 0) {
    await refreshKeyring();
    ({ map, failed } = parseEnvContent(content, configId));
    if (failed.length > 0) {
      console.error(
        `[heku] secrets: could not decrypt ${failed.length} var(s) for "${configId}": ${failed.join(", ")} — check the master key`,
      );
    }
  }

  configEnv.set(configId, map);
  return map.size;
}

/** Remove all env vars for a config from the in-memory store. */
export function unloadConfigEnv(configId: string): void {
  configEnv.delete(configId);
}

/**
 * Resolve an env var for a specific config.
 * Checks the per-config store only — no cross-config bleed.
 * Synchronous and unchanged by envelope encryption: values are already
 * decrypted at load time (see loadConfigEnv).
 */
export function resolveEnv(configId: string, varName: string): string | undefined {
  return configEnv.get(configId)?.get(varName);
}

/**
 * Build the full environment for a child process spawned by a config.
 * Starts from base (process.env by default so PATH/HOME/etc. flow through),
 * overlays per-config secrets, then overlays literal connector.env declarations.
 */
export function buildChildEnv(
  configId: string,
  declared?: Record<string, string>,
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const merged: Record<string, string> = { ...(base as Record<string, string>) };
  const configMap = configEnv.get(configId);
  if (configMap) {
    for (const [k, v] of configMap) merged[k] = v;
  }
  if (declared) {
    for (const [k, v] of Object.entries(declared)) merged[k] = v;
  }
  return merged;
}

/** Load all mcp.*.env files from a config directory into the in-memory store. */
export async function loadAllConfigEnvs(configDir: string): Promise<void> {
  if (!fs.existsSync(configDir)) return;
  let entries: string[];
  try {
    entries = fs.readdirSync(configDir);
  } catch {
    return;
  }
  const envFiles = entries.filter((file) => file.startsWith("mcp.") && file.endsWith(".env"));
  await Promise.all(
    envFiles.map((file) => {
      const configId = file.slice(4, -4); // "mcp.github.env" → "github"
      return loadConfigEnv(configId, path.join(configDir, file));
    }),
  );
}

/**
 * True if `varName` is present in configId's env file and stored as plaintext
 * (not `enc:v1:`). Undefined if the file or the var doesn't exist. Used by
 * `start`'s non-blocking encryption warning (§6.2) — reads the raw file, not
 * the decrypted in-memory store, since the store no longer distinguishes the two.
 */
export function isVarPlaintext(configDir: string, configId: string, varName: string): boolean | undefined {
  const filePath = path.join(configDir, `mcp.${configId}.env`);
  if (!fs.existsSync(filePath)) return undefined;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() !== varName) continue;
    const rawVal = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
    return rawVal.length > 0 && !isEncrypted(rawVal);
  }
  return undefined;
}
