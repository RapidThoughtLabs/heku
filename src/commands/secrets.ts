import fs from "node:fs";
import path from "node:path";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { bold, green, red, yellow, dim } from "../lib/fmt.js";
import { confirm } from "../lib/prompt.js";
import { acquireLock, atomicWriteFileSync } from "../lib/file-lock.js";
import { isEncrypted, encryptValue, decryptValue, decryptWithKeyring, generateMasterKey } from "../lib/secrets/crypto.js";
import {
  initMasterKey,
  ensureKeyring,
  getCachedKeyring,
  getActiveProviderId,
  persistKeyring,
} from "../lib/secrets/master-key.js";
import type { Keyring } from "../lib/secrets/master-key.js";

// ── Shared file helpers ──────────────────────────────────────────

interface EnvFileInfo {
  configId: string;
  filePath: string;
}

function listEnvFiles(configDir: string): EnvFileInfo[] {
  if (!fs.existsSync(configDir)) return [];
  return fs
    .readdirSync(configDir)
    .filter((f) => f.startsWith("mcp.") && f.endsWith(".env"))
    .map((f) => ({ configId: f.slice(4, -4), filePath: path.join(configDir, f) }));
}

function parseLine(line: string): { key: string; rawValue: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const eq = trimmed.indexOf("=");
  if (eq === -1) return null;
  const key = trimmed.slice(0, eq).trim();
  if (!key) return null;
  const rawValue = trimmed.slice(eq + 1).replace(/^["']|["']$/g, "");
  return { key, rawValue };
}

/** Rewrite each `KEY=value` line whose value `transform` maps to a non-null result. Locked + atomic. */
async function transformEnvFile(
  filePath: string,
  transform: (key: string, rawValue: string) => string | null,
): Promise<{ changed: number; total: number }> {
  const release = await acquireLock(filePath);
  try {
    if (!fs.existsSync(filePath)) return { changed: 0, total: 0 };
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    let changed = 0;
    let total = 0;

    const newLines = lines.map((line) => {
      const parsed = parseLine(line);
      if (!parsed || parsed.rawValue.length === 0) return line;
      total++;
      const next = transform(parsed.key, parsed.rawValue);
      if (next === null) return line;
      changed++;
      const eqIdx = line.indexOf("=");
      return `${line.slice(0, eqIdx + 1)}${next}`;
    });

    if (changed > 0) atomicWriteFileSync(filePath, newLines.join("\n"));
    return { changed, total };
  } finally {
    release();
  }
}

function migrateToEncrypted(filePath: string, configId: string, keyring: Keyring) {
  return transformEnvFile(filePath, (key, rawValue) => {
    if (isEncrypted(rawValue)) return null;
    return encryptValue(keyring[0]!, rawValue, `${configId}:${key}`);
  });
}

function migrateToPlaintext(filePath: string, configId: string, keyring: Keyring) {
  return transformEnvFile(filePath, (key, rawValue) => {
    if (!isEncrypted(rawValue)) return null;
    try {
      return decryptWithKeyring(keyring, rawValue, `${configId}:${key}`);
    } catch {
      return null; // leave undecryptable values alone rather than lose them
    }
  });
}

// ── heku secrets init ────────────────────────────────────────────

async function runInit(args: string[]): Promise<void> {
  const force = args.includes("--force");

  if (force) {
    const kr: Keyring = [generateMasterKey()];
    const providerId = await persistKeyring(kr);
    console.log(
      `\n  ${yellow("⚠️  --force: generated a brand-new key.")} Secrets encrypted under the previous key are now unreadable until re-entered.`,
    );
    console.log(`  ${green("✓")} New master key stored via provider "${bold(providerId)}".\n`);
    return;
  }

  const { provider, created } = await ensureKeyring();
  if (created) {
    console.log(
      `\n  ${green("🔑 Generated a master key")} (stored in "${bold(provider.id)}") — your secrets are now encrypted at rest.\n`,
    );
  } else {
    console.log(`\n  ${dim(`A master key already exists (provider: "${provider.id}"). Nothing to do.`)}`);
    console.log(`  ${dim("Use --force to replace it (this orphans secrets encrypted under the old key).")}\n`);
  }
}

// ── heku secrets encrypt [configId] ──────────────────────────────

async function runEncrypt(args: string[], configDir: string): Promise<void> {
  const keyring = getCachedKeyring();
  if (!keyring) {
    console.error(`[heku] No master key loaded. Run "heku secrets init" first.`);
    process.exit(1);
  }

  const targetId = args.find((a) => !a.startsWith("--"));
  const files = listEnvFiles(configDir).filter((f) => !targetId || f.configId === targetId);
  if (files.length === 0) {
    console.error(
      targetId ? `[heku] No secrets file found for "${targetId}".` : `[heku] No secrets files found in ${configDir}.`,
    );
    process.exit(1);
  }

  console.log(`\n  Encrypting secrets under the current master key:`);
  let totalChanged = 0;
  for (const f of files) {
    const { changed, total } = await migrateToEncrypted(f.filePath, f.configId, keyring);
    totalChanged += changed;
    if (changed > 0) {
      console.log(`  ${green("✓")} ${f.configId}: encrypted ${changed}/${total} value(s)`);
    } else {
      console.log(`  ${dim("·")} ${f.configId}: already encrypted (${total} value(s))`);
    }
  }
  console.log(`\n  Done — ${totalChanged} value(s) migrated to enc:v1.\n`);
}

// ── heku secrets status ───────────────────────────────────────────

async function runStatus(configDir: string): Promise<void> {
  const keyring = getCachedKeyring();
  const providerId = getActiveProviderId();
  const SEP = "─".repeat(44);

  console.log(`\n  Secrets status:`);
  console.log(`  ${SEP}`);
  if (!keyring) {
    console.log(`  ${red("No master key loaded.")} Run "heku secrets init" or "heku auth setup".`);
  } else {
    console.log(`  provider:       ${bold(providerId ?? "unknown")}`);
    console.log(`  rotation grace: ${keyring.length > 1 ? yellow("active (previous key retained)") : dim("none")}`);
  }
  console.log(`  ${SEP}`);

  const files = listEnvFiles(configDir);
  if (files.length === 0) {
    console.log(`\n  ${dim("No mcp.*.env files found.")}\n`);
    return;
  }

  for (const f of files) {
    const content = fs.readFileSync(f.filePath, "utf-8");
    let enc = 0;
    let plain = 0;
    for (const line of content.split(/\r?\n/)) {
      const parsed = parseLine(line);
      if (!parsed || parsed.rawValue.length === 0) continue;
      if (isEncrypted(parsed.rawValue)) enc++;
      else plain++;
    }
    const state =
      enc > 0 && plain > 0
        ? yellow("mixed")
        : enc > 0
          ? green("encrypted")
          : plain > 0
            ? red("plaintext")
            : dim("empty");
    console.log(`  ${f.configId.padEnd(20)} ${state}  ${dim(`(${enc} enc / ${plain} plain)`)}`);
  }
  console.log();
}

// ── heku secrets decrypt [configId] ──────────────────────────────
// Escape hatch. Confirms interactively unless --yes is passed — intentionally
// undocumented in --help / printUsage so it doesn't read as agent-facing (§11.5).

async function runDecrypt(args: string[], configDir: string): Promise<void> {
  const yes = args.includes("--yes");
  const targetId = args.find((a) => !a.startsWith("--"));

  const keyring = getCachedKeyring();
  if (!keyring) {
    console.error(`[heku] No master key loaded — nothing to decrypt.`);
    process.exit(1);
  }

  if (!yes) {
    console.log(
      `\n  ${yellow("⚠️  This rewrites secrets as PLAINTEXT on disk.")} Anyone who can read the config dir will see them.`,
    );
    const proceed = await confirm(`  Continue? (y/n): `);
    if (!proceed) {
      console.log(`  Aborted.\n`);
      return;
    }
  }

  const files = listEnvFiles(configDir).filter((f) => !targetId || f.configId === targetId);
  if (files.length === 0) {
    console.error(
      targetId ? `[heku] No secrets file found for "${targetId}".` : `[heku] No secrets files found in ${configDir}.`,
    );
    process.exit(1);
  }

  let totalChanged = 0;
  for (const f of files) {
    const { changed, total } = await migrateToPlaintext(f.filePath, f.configId, keyring);
    totalChanged += changed;
    if (changed > 0) {
      console.log(`  ${yellow("✓")} ${f.configId}: decrypted ${changed}/${total} value(s)`);
    } else {
      console.log(`  ${dim("·")} ${f.configId}: nothing to decrypt (${total} value(s))`);
    }
  }
  console.log(`\n  Done — ${totalChanged} value(s) reverted to plaintext.\n`);
}

// ── heku secrets rotate ───────────────────────────────────────────
// Full protocol: docs/envelope-secret-encryption-plan.md §12.3.

const ROTATE_CONCURRENCY = 20;

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/**
 * Re-encrypt every `enc:v1:` value in one file under `targetKey`, decrypting with
 * whichever key in `keyring` authenticates. A value already under `targetKey` is
 * left untouched; plaintext is left alone; a value that fails against every key in
 * the keyring is left alone and counted as a failure rather than losing data.
 */
function reencryptFile(
  filePath: string,
  configId: string,
  keyring: Keyring,
  targetKey: Buffer,
): Promise<{ changed: number; total: number; failed: number }> {
  let failed = 0;
  return transformEnvFile(filePath, (key, rawValue) => {
    if (!isEncrypted(rawValue)) return null;
    const aad = `${configId}:${key}`;

    try {
      decryptValue(targetKey, rawValue, aad);
      return null; // already under the target key — nothing to do
    } catch {
      // needs re-encryption under the target key
    }

    try {
      const plaintext = decryptWithKeyring(keyring, rawValue, aad);
      return encryptValue(targetKey, plaintext, aad);
    } catch {
      failed++;
      console.error(`[heku] ⚠ ${configId}:${key} did not decrypt under any key in the keyring — left unchanged.`);
      return null;
    }
  }).then((r) => ({ ...r, failed }));
}

export async function runRotate(configDir: string): Promise<void> {
  const keyring = getCachedKeyring();
  if (!keyring) {
    console.error(`[heku] No master key loaded — nothing to rotate. Run "heku secrets init" first.`);
    process.exit(1);
  }

  if (getActiveProviderId() === "env-var") {
    console.error(
      `\n  [heku] Cannot rotate under the "env-var" provider — HEKU_MASTER_KEY is read-only.\n` +
        `  Roll the key at the platform level instead: set HEKU_MASTER_KEY to the new key and\n` +
        `  HEKU_MASTER_KEY_PREVIOUS to the current one, then run "heku secrets encrypt" to migrate files.\n`,
    );
    process.exit(1);
  }

  const files = listEnvFiles(configDir);
  if (files.length === 0) {
    console.log(`\n  ${dim("No mcp.*.env files found — nothing to rotate.")}\n`);
    return;
  }

  // Preflight: finish any stragglers left by a previous rotation that crashed
  // mid-rewrite, so the previous key can be safely dropped from the keyring below.
  if (keyring.length > 1) {
    console.log(`\n  ${yellow("Finishing an incomplete previous rotation first...")}`);
    const results = await mapWithConcurrency(files, ROTATE_CONCURRENCY, (f) =>
      reencryptFile(f.filePath, f.configId, keyring, keyring[0]!),
    );
    const finished = results.reduce((n, r) => n + r.changed, 0);
    const strayFailed = results.reduce((n, r) => n + r.failed, 0);
    if (finished > 0) console.log(`  ${green("✓")} finished ${finished} straggling value(s).`);
    if (strayFailed > 0) {
      console.error(
        `\n  [heku] ${strayFailed} value(s) from the previous rotation are still undecryptable.\n` +
          `  Resolve those before rotating again.\n`,
      );
      process.exit(1);
    }
  }

  // Persist [K_new, K_old] before touching any file (§12.3) — every intermediate
  // on-disk state produced below stays decryptable by this keyring.
  const newKey = generateMasterKey();
  const rotatedKeyring: Keyring = [newKey, keyring[0]!];
  const providerId = await persistKeyring(rotatedKeyring);
  console.log(
    `  ${green("✓")} New key persisted via provider "${bold(providerId)}" — previous key retained for the grace window.`,
  );

  console.log(`  Rotating ${files.length} file(s)...`);
  let done = 0;
  let totalChanged = 0;
  let totalFailed = 0;
  await mapWithConcurrency(files, ROTATE_CONCURRENCY, async (f) => {
    const { changed, failed } = await reencryptFile(f.filePath, f.configId, rotatedKeyring, newKey);
    totalChanged += changed;
    totalFailed += failed;
    done++;
    process.stdout.write(`\r  rotating ${done}/${files.length}...`);
  });
  process.stdout.write("\n");

  console.log(`\n  Done — ${totalChanged} value(s) rotated across ${files.length} file(s).`);
  if (totalFailed > 0) {
    console.log(`  ${yellow(`⚠ ${totalFailed} value(s) could not be decrypted with any key and were left unchanged.`)}`);
  }
  console.log(`  ${dim("The previous key remains active for decryption until the next rotation.")}\n`);

  if (totalFailed > 0) process.exit(1);
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  const subcommand = args[0];
  await initMasterKey();

  const systemConfig = loadSystemConfig(process.cwd());
  const configDir = resolveConfigDir(undefined, systemConfig);

  switch (subcommand) {
    case "init":
      await runInit(args.slice(1));
      break;

    case "encrypt":
      await runEncrypt(args.slice(1), configDir);
      break;

    case "status":
      await runStatus(configDir);
      break;

    case "decrypt":
      await runDecrypt(args.slice(1), configDir);
      break;

    case "rotate":
      await runRotate(configDir);
      break;

    case undefined:
    default:
      console.error(
        `[heku] Unknown secrets subcommand: "${subcommand ?? ""}".\n` +
        `  Usage: heku secrets init | encrypt [service] | rotate | status | decrypt [service]`,
      );
      process.exit(1);
  }
}
