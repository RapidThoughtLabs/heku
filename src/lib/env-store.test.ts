import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadConfigEnv,
  unloadConfigEnv,
  resolveEnv,
  buildChildEnv,
  loadAllConfigEnvs,
  isVarPlaintext,
} from "./env-store.js";
import {
  initMasterKey,
  getCachedKeyring,
  __setProvidersForTesting,
  __getProvidersForTesting,
} from "./secrets/master-key.js";
import type { MasterKeyProvider } from "./secrets/master-key.js";
import { EnvVarProvider } from "./secrets/providers/env-var.js";
import { KeyFileProvider } from "./secrets/providers/key-file.js";
import { encryptValue } from "./secrets/crypto.js";

const ENV_KEY = "HEKU_MASTER_KEY";

describe("env-store — decryption at load time", () => {
  const original = { stateDir: process.env.HEKU_STATE_DIR, key: process.env[ENV_KEY] };
  let tmpDir: string;
  let configDir: string;
  let originalProviders: MasterKeyProvider[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-envstore-test-"));
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

  function writeEnvFile(configId: string, content: string): string {
    const filePath = path.join(configDir, `mcp.${configId}.env`);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  it("loads a plaintext-only file with no keyring needed", async () => {
    await initMasterKey(); // nothing configured — cachedKeyring stays null
    const filePath = writeEnvFile("svc-plain", "GITHUB_TOKEN=ghp_abc123\n");
    const count = await loadConfigEnv("svc-plain", filePath);
    expect(count).toBe(1);
    expect(resolveEnv("svc-plain", "GITHUB_TOKEN")).toBe("ghp_abc123");
  });

  it("decrypts enc:v1 values when the right key is loaded", async () => {
    const key = Buffer.alloc(32, 5);
    process.env[ENV_KEY] = key.toString("base64");
    await initMasterKey();

    const encoded = encryptValue(key, "ghp_secret", "svc-enc:GITHUB_TOKEN");
    const filePath = writeEnvFile("svc-enc", `GITHUB_TOKEN=${encoded}\n`);

    await loadConfigEnv("svc-enc", filePath);
    expect(resolveEnv("svc-enc", "GITHUB_TOKEN")).toBe("ghp_secret");
  });

  it("reads mixed plaintext + encrypted files correctly", async () => {
    const key = Buffer.alloc(32, 6);
    process.env[ENV_KEY] = key.toString("base64");
    await initMasterKey();

    const encoded = encryptValue(key, "secret-val", "svc-mixed:API_KEY");
    const filePath = writeEnvFile("svc-mixed", `API_KEY=${encoded}\nPLAIN_VAR=not-a-secret\n`);

    await loadConfigEnv("svc-mixed", filePath);
    expect(resolveEnv("svc-mixed", "API_KEY")).toBe("secret-val");
    expect(resolveEnv("svc-mixed", "PLAIN_VAR")).toBe("not-a-secret");
  });

  it("skips undecryptable values instead of crashing the whole load", async () => {
    // No keyring loaded at all — enc:v1 value can't be decrypted.
    await initMasterKey();
    const key = Buffer.alloc(32, 7);
    const encoded = encryptValue(key, "secret-val", "svc-nokey:API_KEY");
    const filePath = writeEnvFile("svc-nokey", `API_KEY=${encoded}\nPLAIN_VAR=still-fine\n`);

    const count = await loadConfigEnv("svc-nokey", filePath);
    expect(count).toBe(1); // only PLAIN_VAR made it in
    expect(resolveEnv("svc-nokey", "API_KEY")).toBeUndefined();
    expect(resolveEnv("svc-nokey", "PLAIN_VAR")).toBe("still-fine");
  });

  it("wrong key surfaces as a skipped value, not a thrown error", async () => {
    process.env[ENV_KEY] = Buffer.alloc(32, 1).toString("base64");
    await initMasterKey();

    const otherKey = Buffer.alloc(32, 2);
    const encoded = encryptValue(otherKey, "secret-val", "svc-wrongkey:API_KEY");
    const filePath = writeEnvFile("svc-wrongkey", `API_KEY=${encoded}\n`);

    await expect(loadConfigEnv("svc-wrongkey", filePath)).resolves.toBe(0);
    expect(resolveEnv("svc-wrongkey", "API_KEY")).toBeUndefined();
  });

  it("refresh-on-failure: picks up a keyring that appeared after the initial (empty) load", async () => {
    // Instance starts with no keyring cached...
    await initMasterKey();
    expect(getCachedKeyring()).toBeNull();

    // ...then "another instance" creates one directly on disk — bypassing this
    // module's cache entirely, the way a genuinely separate process would.
    const key = Buffer.alloc(32, 8);
    await new KeyFileProvider().setKeyring([key]);
    const encoded = encryptValue(key, "fresh-secret", "svc-refresh:TOKEN");
    const filePath = writeEnvFile("svc-refresh", `TOKEN=${encoded}\n`);

    // First parse attempt fails against the still-null cache, which triggers
    // one refreshKeyring() re-read and a retry — all inside loadConfigEnv.
    const count = await loadConfigEnv("svc-refresh", filePath);
    expect(count).toBe(1);
    expect(resolveEnv("svc-refresh", "TOKEN")).toBe("fresh-secret");
  });

  it("unloadConfigEnv removes a config's vars", async () => {
    await initMasterKey();
    const filePath = writeEnvFile("svc-unload", "X=1\n");
    await loadConfigEnv("svc-unload", filePath);
    expect(resolveEnv("svc-unload", "X")).toBe("1");

    unloadConfigEnv("svc-unload");
    expect(resolveEnv("svc-unload", "X")).toBeUndefined();
  });

  it("loadConfigEnv on a missing file clears any existing entry and returns 0", async () => {
    await initMasterKey();
    const filePath = writeEnvFile("svc-missing", "X=1\n");
    await loadConfigEnv("svc-missing", filePath);
    fs.unlinkSync(filePath);

    const count = await loadConfigEnv("svc-missing", filePath);
    expect(count).toBe(0);
    expect(resolveEnv("svc-missing", "X")).toBeUndefined();
  });

  it("loadAllConfigEnvs loads every mcp.*.env file in the directory", async () => {
    await initMasterKey();
    writeEnvFile("svc-a", "A=1\n");
    writeEnvFile("svc-b", "B=2\n");

    await loadAllConfigEnvs(configDir);
    expect(resolveEnv("svc-a", "A")).toBe("1");
    expect(resolveEnv("svc-b", "B")).toBe("2");
  });

  it("buildChildEnv overlays config secrets and declared env onto the base", async () => {
    await initMasterKey();
    const filePath = writeEnvFile("svc-child", "SECRET=shh\n");
    await loadConfigEnv("svc-child", filePath);

    const env = buildChildEnv("svc-child", { LITERAL: "x" }, { BASE: "y" } as unknown as NodeJS.ProcessEnv);
    expect(env).toMatchObject({ BASE: "y", SECRET: "shh", LITERAL: "x" });
  });

  describe("isVarPlaintext", () => {
    it("returns true for a plaintext var", () => {
      const filePath = writeEnvFile("svc-ivp-plain", "TOKEN=abc\n");
      expect(isVarPlaintext(configDir, "svc-ivp-plain", "TOKEN")).toBe(true);
      void filePath;
    });

    it("returns false for an encrypted var", () => {
      const key = Buffer.alloc(32, 1);
      const encoded = encryptValue(key, "abc", "svc-ivp-enc:TOKEN");
      writeEnvFile("svc-ivp-enc", `TOKEN=${encoded}\n`);
      expect(isVarPlaintext(configDir, "svc-ivp-enc", "TOKEN")).toBe(false);
    });

    it("returns undefined when the var or file is missing", () => {
      expect(isVarPlaintext(configDir, "svc-ivp-missing", "TOKEN")).toBeUndefined();
      writeEnvFile("svc-ivp-present", "OTHER=1\n");
      expect(isVarPlaintext(configDir, "svc-ivp-present", "TOKEN")).toBeUndefined();
    });
  });
});
