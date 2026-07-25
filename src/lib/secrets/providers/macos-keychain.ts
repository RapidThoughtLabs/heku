import { spawn } from "node:child_process";
import type { MasterKeyProvider } from "../master-key.js";
import type { Keyring } from "../keyring-codec.js";
import { encodeKeyring, decodeKeyring } from "../keyring-codec.js";
import { isOnPath } from "./which.js";

const ACCOUNT = "heku";
const SERVICE = "heku-master-key";
const TIMEOUT_MS = 5000;

/**
 * Runs `security -i` (interactive mode) and feeds it one command line via stdin.
 * Interactive mode exists specifically so the secret in `-w <value>` never appears
 * as a process argument (visible via `ps` to any other process on the machine) —
 * it only ever crosses this process's stdin pipe.
 */
function runSecurityCommand(commandLine: string): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn("security", ["-i"], { stdio: ["pipe", "pipe", "pipe"], timeout: TIMEOUT_MS });
    let stdout = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d;
    });
    child.stderr.on("data", () => {}); // discarded — failures surface via exit code
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, code }));
    child.stdin.write(`${commandLine}\n`);
    child.stdin.end();
  });
}

/**
 * macOS Keychain adapter (§3.2/§3.3). Stores the keyring as a single generic-password
 * item (service "heku-master-key", account "heku"). The stored value is the base64 of
 * the same JSON blob KeyFileProvider writes to disk — base64 keeps it one
 * whitespace-free token, so `security -i`'s command-line tokenizer never has to quote
 * or escape it.
 */
export class MacOSKeychainProvider implements MasterKeyProvider {
  readonly id = "macos-keychain";
  readonly writable = true;

  async isAvailable(): Promise<boolean> {
    return process.platform === "darwin" && isOnPath("security");
  }

  async getKeyring(): Promise<Keyring | null> {
    const { stdout, code } = await runSecurityCommand(`find-generic-password -a ${ACCOUNT} -s ${SERVICE} -w`);
    if (code !== 0) return null; // not found, or keychain inaccessible — let the chain fall through
    const line = stdout.trim().split("\n").pop() ?? "";
    if (!line) return null;
    return decodeKeyring(Buffer.from(line, "base64").toString("utf-8"));
  }

  async setKeyring(kr: Keyring): Promise<void> {
    const value = Buffer.from(encodeKeyring(kr), "utf-8").toString("base64");
    const { code } = await runSecurityCommand(`add-generic-password -a ${ACCOUNT} -s ${SERVICE} -w ${value} -U`);
    if (code !== 0) throw new Error(`security add-generic-password failed (exit code ${code})`);
  }
}
