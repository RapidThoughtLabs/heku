import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { MasterKeyProvider } from "../master-key.js";
import type { Keyring } from "../keyring-codec.js";
import { encodeKeyring, decodeKeyring } from "../keyring-codec.js";
import { stateDir } from "../../paths.js";
import { atomicWriteFileSync } from "../../file-lock.js";
import { isOnPath } from "./which.js";

const TIMEOUT_MS = 5000;

function dpapiFilePath(): string {
  return path.join(stateDir(), "..", "master.key.dpapi");
}

function runPowerShell(script: string, stdin: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d;
    });
    child.stderr.on("data", () => {});
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

// Both scripts move the payload through stdin/stdout as base64 text, never argv, and
// operate purely on bytes — so the JSON blob's own characters never have to survive
// PowerShell string-literal quoting.
const PROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
$bytes = [System.Convert]::FromBase64String($b64)
$protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Convert]::ToBase64String($protected))
`.trim();

const UNPROTECT_SCRIPT = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
$bytes = [System.Convert]::FromBase64String($b64)
$unprotected = [System.Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
[Console]::Out.Write([System.Convert]::ToBase64String($unprotected))
`.trim();

/**
 * Windows adapter (§3.2/§3.3) — DPAPI (CurrentUser scope) via PowerShell's
 * `System.Security.Cryptography.ProtectedData`. The DPAPI ciphertext is stored at
 * `~/.heku/master.key.dpapi`; it's meaningless off this machine/user account without
 * the Windows-managed DPAPI master key, so the file needs no extra ACL beyond the OS
 * default.
 */
export class WindowsDpapiProvider implements MasterKeyProvider {
  readonly id = "windows-dpapi";
  readonly writable = true;

  async isAvailable(): Promise<boolean> {
    return process.platform === "win32" && isOnPath("powershell");
  }

  async getKeyring(): Promise<Keyring | null> {
    const fp = dpapiFilePath();
    if (!fs.existsSync(fp)) return null;
    const protectedB64 = fs.readFileSync(fp, "utf-8").trim();
    if (!protectedB64) return null;
    const { stdout, code } = await runPowerShell(UNPROTECT_SCRIPT, protectedB64);
    if (code !== 0) throw new Error(`DPAPI unprotect failed (exit code ${code})`);
    const blob = Buffer.from(stdout.trim(), "base64").toString("utf-8");
    return decodeKeyring(blob);
  }

  async setKeyring(kr: Keyring): Promise<void> {
    const plainB64 = Buffer.from(encodeKeyring(kr), "utf-8").toString("base64");
    const { stdout, code } = await runPowerShell(PROTECT_SCRIPT, plainB64);
    if (code !== 0) throw new Error(`DPAPI protect failed (exit code ${code})`);

    const fp = dpapiFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    atomicWriteFileSync(fp, stdout.trim(), 0o600);
  }
}
