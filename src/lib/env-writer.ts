import fs from "node:fs";
import path from "node:path";
import { loadConfigEnv } from "./env-store.js";
import { acquireLock, atomicWriteFileSync } from "./file-lock.js";
import { encryptValue } from "./secrets/crypto.js";
import { getCachedKeyring } from "./secrets/master-key.js";

const GITIGNORE_PATH = path.join(process.cwd(), ".gitignore");

export interface EnvEntry {
  key: string;
  value: string;
}

export interface AppendResult {
  written: string[];
  skipped: string[];
}

function parseLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function findKeyLine(lines: string[], key: string): number {
  return lines.findIndex((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed === "") return false;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return false;
    return trimmed.slice(0, eq).trim() === key;
  });
}

/**
 * Write env vars to a per-config secrets file at {configDir}/mcp.{configId}.env.
 * Skips vars already present unless `overwrite` is true (replaces in-place).
 * After writing, immediately reloads the in-memory env store for this config.
 *
 * Encrypts under the current master key when one is loaded (`enc:v1:...`); writes
 * plaintext + a one-line warning otherwise. This is a pure writer — it never
 * generates a key itself (§3.1, §6.4); callers that want encryption-by-default
 * (`auth setup`) are responsible for calling `ensureKeyring()` first.
 */
export async function writeConfigEnv(
  configDir: string,
  configId: string,
  entries: EnvEntry[],
  overwrite = false,
): Promise<AppendResult> {
  const written: string[] = [];
  const skipped: string[] = [];

  const valid = entries.filter((e) => e.value.length > 0);
  if (valid.length === 0) return { written, skipped };

  const filePath = path.join(configDir, `mcp.${configId}.env`);
  const release = await acquireLock(filePath);

  try {
    const keyring = getCachedKeyring();
    const storedValue = (key: string, value: string): string =>
      keyring ? encryptValue(keyring[0]!, value, `${configId}:${key}`) : value;

    const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
    const isNewFile = !existing;
    const lines = existing ? parseLines(existing) : [];

    while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

    const toAppend: EnvEntry[] = [];

    for (const entry of valid) {
      const idx = findKeyLine(lines, entry.key);
      if (idx !== -1 && !overwrite) {
        skipped.push(entry.key);
        continue;
      }
      if (idx !== -1 && overwrite) {
        lines[idx] = `${entry.key}=${storedValue(entry.key, entry.value)}`;
        written.push(entry.key);
      } else {
        toAppend.push({ key: entry.key, value: storedValue(entry.key, entry.value) });
      }
    }

    let result = lines.join("\n");

    if (toAppend.length > 0) {
      if (isNewFile) {
        result = keyring
          ? `# heku secrets for ${configId} — encrypted, do not commit\n`
          : `# heku secrets for ${configId} — do not commit\n`;
      } else {
        result += "\n";
      }
      for (const e of toAppend) {
        result += `${e.key}=${e.value}\n`;
        written.push(e.key);
      }
    } else if (written.length > 0) {
      result += "\n";
    }

    if (written.length > 0) {
      atomicWriteFileSync(filePath, result, 0o600);
      if (!keyring) {
        console.error(
          `[heku] ⚠ wrote ${written.length} secret(s) to mcp.${configId}.env as plaintext — no master key loaded. Run 'heku secrets init' or 'heku auth setup' to encrypt.`,
        );
      }
      await loadConfigEnv(configId, filePath);
    }

    return { written, skipped };
  } finally {
    release();
  }
}

/**
 * Returns true if "mcp.*.env" (or a broad *.env / .env) pattern appears
 * in the project's .gitignore.
 */
export function isEnvInGitignore(): boolean {
  if (!fs.existsSync(GITIGNORE_PATH)) return false;
  const content = fs.readFileSync(GITIGNORE_PATH, "utf-8");
  return content.split(/\r?\n/).some((line) => {
    const t = line.trim();
    return (
      t === ".env" ||
      t === ".env*" ||
      t === "*.env" ||
      t === "/.env" ||
      t === "mcp.*.env"
    );
  });
}
