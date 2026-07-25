import { spawn } from "node:child_process";
import type { MasterKeyProvider } from "../master-key.js";
import type { Keyring } from "../keyring-codec.js";
import { encodeKeyring, decodeKeyring } from "../keyring-codec.js";
import { isOnPath } from "./which.js";

const ATTRS = ["service", "heku", "key", "master"];
const TIMEOUT_MS = 5000;

function run(args: string[], stdin?: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("secret-tool", args, { stdio: ["pipe", "pipe", "pipe"], timeout: TIMEOUT_MS });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d;
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
    if (stdin !== undefined) child.stdin.write(stdin);
    child.stdin.end();
  });
}

/**
 * Linux desktop adapter (§3.2/§3.3) — GNOME Keyring / KDE Wallet via libsecret's
 * `secret-tool`. Requires a running session bus, so it's unavailable by design on
 * headless Linux/CI/Docker, which fall straight through to KeyFileProvider.
 */
export class LinuxSecretToolProvider implements MasterKeyProvider {
  readonly id = "linux-secret-tool";
  readonly writable = true;

  async isAvailable(): Promise<boolean> {
    return process.platform === "linux" && !!process.env.DBUS_SESSION_BUS_ADDRESS && isOnPath("secret-tool");
  }

  async getKeyring(): Promise<Keyring | null> {
    const { stdout, code } = await run(["lookup", ...ATTRS]);
    if (code !== 0) return null;
    const line = stdout.trim();
    if (!line) return null;
    return decodeKeyring(Buffer.from(line, "base64").toString("utf-8"));
  }

  async setKeyring(kr: Keyring): Promise<void> {
    const value = Buffer.from(encodeKeyring(kr), "utf-8").toString("base64");
    const { code } = await run(["store", "--label=heku master key", ...ATTRS], value);
    if (code !== 0) throw new Error(`secret-tool store failed (exit code ${code})`);
  }
}
