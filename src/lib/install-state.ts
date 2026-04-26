import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { McpConnectorConfig } from "../types.js";
import { installSentinelDir } from "./paths.js";

export interface InstallSentinel {
  config_id: string;
  fingerprint: string;
  installed_at: string;
  install_log_tail: string[];
  exit_code: 0;
}

export function fingerprintInstall(cfg: McpConnectorConfig): string {
  const payload = JSON.stringify({
    install_command: cfg.install_command ?? null,
    install_args: cfg.install_args ?? null,
    install_env: cfg.install_env
      ? Object.fromEntries(Object.entries(cfg.install_env).sort(([a], [b]) => a.localeCompare(b)))
      : null,
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function sentinelPath(configId: string): string {
  return path.join(installSentinelDir(), `${configId}.json`);
}

export function readSentinel(configId: string): InstallSentinel | null {
  const p = sentinelPath(configId);
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return JSON.parse(raw) as InstallSentinel;
  } catch {
    return null;
  }
}

export function writeSentinel(s: InstallSentinel): void {
  const dir = installSentinelDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = sentinelPath(s.config_id);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export function clearSentinel(configId: string): void {
  try {
    fs.unlinkSync(sentinelPath(configId));
  } catch {
    // already absent — fine
  }
}
