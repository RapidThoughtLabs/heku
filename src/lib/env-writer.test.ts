import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeConfigEnv } from "./env-writer.js";
import { resolveEnv } from "./env-store.js";
import {
  initMasterKey,
  __setProvidersForTesting,
  __getProvidersForTesting,
} from "./secrets/master-key.js";
import type { MasterKeyProvider } from "./secrets/master-key.js";
import { EnvVarProvider } from "./secrets/providers/env-var.js";
import { KeyFileProvider } from "./secrets/providers/key-file.js";
import { decryptValue, isEncrypted } from "./secrets/crypto.js";

const ENV_KEY = "HEKU_MASTER_KEY";

describe("writeConfigEnv", () => {
  const original = { stateDir: process.env.HEKU_STATE_DIR, key: process.env[ENV_KEY] };
  let tmpDir: string;
  let configDir: string;
  let originalProviders: MasterKeyProvider[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-envwriter-test-"));
    configDir = path.join(tmpDir, "configs");
    fs.mkdirSync(configDir);
    process.env.HEKU_STATE_DIR = path.join(tmpDir, "state");
    delete process.env[ENV_KEY];

    // Real KeyFileProvider against a tmp dir, never a real OS keychain (§Test isolation).
    originalProviders = __getProvidersForTesting();
    __setProvidersForTesting([new EnvVarProvider(), new KeyFileProvider()]);
  });

  afterEach(() => {
    if (original.stateDir === undefined) delete process.env.HEKU_STATE_DIR;
    else process.env.HEKU_STATE_DIR = original.stateDir;
    if (original.key === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original.key;
    __setProvidersForTesting(originalProviders);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function readFile(configId: string): string {
    return fs.readFileSync(path.join(configDir, `mcp.${configId}.env`), "utf-8");
  }

  it("writes plaintext and warns when no keyring is loaded", async () => {
    await initMasterKey();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await writeConfigEnv(configDir, "svc-plain", [{ key: "TOKEN", value: "abc123" }]);
    expect(result.written).toEqual(["TOKEN"]);

    const content = readFile("svc-plain");
    expect(content).toContain("TOKEN=abc123");
    expect(content.split("\n")[0]).toBe("# heku secrets for svc-plain — do not commit");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("plaintext"));

    errSpy.mockRestore();
  });

  it("encrypts under the current key when a keyring is loaded", async () => {
    const key = Buffer.alloc(32, 3);
    process.env[ENV_KEY] = key.toString("base64");
    await initMasterKey();

    const result = await writeConfigEnv(configDir, "svc-enc", [{ key: "TOKEN", value: "abc123" }]);
    expect(result.written).toEqual(["TOKEN"]);

    const content = readFile("svc-enc");
    expect(content.split("\n")[0]).toBe("# heku secrets for svc-enc — encrypted, do not commit");

    const line = content.split("\n").find((l) => l.startsWith("TOKEN="))!;
    const storedValue = line.slice("TOKEN=".length);
    expect(isEncrypted(storedValue)).toBe(true);
    expect(decryptValue(key, storedValue, "svc-enc:TOKEN")).toBe("abc123");
  });

  it("reloads the in-memory store after writing", async () => {
    const key = Buffer.alloc(32, 4);
    process.env[ENV_KEY] = key.toString("base64");
    await initMasterKey();

    await writeConfigEnv(configDir, "svc-reload", [{ key: "TOKEN", value: "abc123" }]);
    expect(resolveEnv("svc-reload", "TOKEN")).toBe("abc123");
  });

  it("skips already-set keys unless overwrite is true", async () => {
    await initMasterKey();
    await writeConfigEnv(configDir, "svc-overwrite", [{ key: "TOKEN", value: "first" }]);

    const skipped = await writeConfigEnv(configDir, "svc-overwrite", [{ key: "TOKEN", value: "second" }], false);
    expect(skipped.skipped).toEqual(["TOKEN"]);
    expect(resolveEnv("svc-overwrite", "TOKEN")).toBe("first");

    const overwritten = await writeConfigEnv(configDir, "svc-overwrite", [{ key: "TOKEN", value: "second" }], true);
    expect(overwritten.written).toEqual(["TOKEN"]);
    expect(resolveEnv("svc-overwrite", "TOKEN")).toBe("second");
  });

  it("writes the file with mode 0600", async () => {
    await initMasterKey();
    await writeConfigEnv(configDir, "svc-mode", [{ key: "TOKEN", value: "abc" }]);
    const mode = fs.statSync(path.join(configDir, "mcp.svc-mode.env")).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("ignores entries with an empty value", async () => {
    await initMasterKey();
    const result = await writeConfigEnv(configDir, "svc-empty", [{ key: "TOKEN", value: "" }]);
    expect(result.written).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(fs.existsSync(path.join(configDir, "mcp.svc-empty.env"))).toBe(false);
  });

  it("concurrent writers to the same config serialize with no lost update", async () => {
    await initMasterKey();

    await Promise.all([
      writeConfigEnv(configDir, "svc-concurrent", [{ key: "A", value: "1" }]),
      writeConfigEnv(configDir, "svc-concurrent", [{ key: "B", value: "2" }]),
      writeConfigEnv(configDir, "svc-concurrent", [{ key: "C", value: "3" }]),
    ]);

    const content = readFile("svc-concurrent");
    expect(content).toContain("A=1");
    expect(content).toContain("B=2");
    expect(content).toContain("C=3");

    // No lock directories or temp files left behind.
    const leftovers = fs.readdirSync(configDir).filter((f) => f !== "mcp.svc-concurrent.env");
    expect(leftovers).toHaveLength(0);
  });
});
