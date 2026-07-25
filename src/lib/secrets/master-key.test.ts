import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initMasterKey,
  ensureKeyring,
  refreshKeyring,
  persistKeyring,
  getCachedKeyring,
  getActiveProviderId,
  __setProvidersForTesting,
  __getProvidersForTesting,
} from "./master-key.js";
import type { MasterKeyProvider } from "./master-key.js";
import { EnvVarProvider } from "./providers/env-var.js";
import { KeyFileProvider } from "./providers/key-file.js";
import { masterKeyFilePath } from "../paths.js";

const ENV_KEY = "HEKU_MASTER_KEY";
const ENV_KEY_PREVIOUS = "HEKU_MASTER_KEY_PREVIOUS";

describe("master-key orchestration", () => {
  const originalEnv = {
    stateDir: process.env.HEKU_STATE_DIR,
    key: process.env[ENV_KEY],
    prevKey: process.env[ENV_KEY_PREVIOUS],
  };
  let tmpDir: string;
  let originalProviders: MasterKeyProvider[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-masterkey-test-"));
    process.env.HEKU_STATE_DIR = path.join(tmpDir, "state");
    delete process.env[ENV_KEY];
    delete process.env[ENV_KEY_PREVIOUS];
    // Orchestration tests only care about generic provider-chain behavior — pin to
    // env-var + key-file so they never touch a real OS keychain, on any dev machine.
    originalProviders = __getProvidersForTesting();
    __setProvidersForTesting([new EnvVarProvider(), new KeyFileProvider()]);
  });

  afterEach(() => {
    if (originalEnv.stateDir === undefined) delete process.env.HEKU_STATE_DIR;
    else process.env.HEKU_STATE_DIR = originalEnv.stateDir;
    if (originalEnv.key === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv.key;
    if (originalEnv.prevKey === undefined) delete process.env[ENV_KEY_PREVIOUS];
    else process.env[ENV_KEY_PREVIOUS] = originalEnv.prevKey;
    __setProvidersForTesting(originalProviders);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("initMasterKey() finds nothing when no provider has a keyring", async () => {
    await initMasterKey();
    expect(getCachedKeyring()).toBeNull();
    expect(getActiveProviderId()).toBeNull();
  });

  it("EnvVarProvider outranks KeyFileProvider", async () => {
    // Seed the key file with one key, and the env var with a different one.
    await new KeyFileProvider().setKeyring([Buffer.alloc(32, 1)]);
    const envKey = Buffer.alloc(32, 2);
    process.env[ENV_KEY] = envKey.toString("base64");

    await initMasterKey();
    expect(getActiveProviderId()).toBe("env-var");
    expect(getCachedKeyring()![0]!.equals(envKey)).toBe(true);
  });

  it("falls back to KeyFileProvider when no env var is set", async () => {
    const fileKey = Buffer.alloc(32, 3);
    await new KeyFileProvider().setKeyring([fileKey]);

    await initMasterKey();
    expect(getActiveProviderId()).toBe("key-file");
    expect(getCachedKeyring()![0]!.equals(fileKey)).toBe(true);
  });

  it("ensureKeyring() generates a key on first call (genesis)", async () => {
    const result = await ensureKeyring();
    expect(result.created).toBe(true);
    expect(result.provider.id).toBe("key-file");
    expect(result.keyring[0]!.length).toBe(32);
    expect(getCachedKeyring()![0]!.equals(result.keyring[0]!)).toBe(true);
  });

  it("ensureKeyring() adopts an existing key instead of generating a second one", async () => {
    const first = await ensureKeyring();
    expect(first.created).toBe(true);

    const second = await ensureKeyring();
    expect(second.created).toBe(false);
    expect(second.keyring[0]!.equals(first.keyring[0]!)).toBe(true);
  });

  it("ensureKeyring() adopts a key that another process already wrote (genesis race)", async () => {
    // Simulate a second instance winning the race before this one calls ensureKeyring().
    const winnerKey = Buffer.alloc(32, 9);
    await new KeyFileProvider().setKeyring([winnerKey]);

    const result = await ensureKeyring();
    expect(result.created).toBe(false);
    expect(result.keyring[0]!.equals(winnerKey)).toBe(true);
  });

  it("persistKeyring() writes via the best writable provider and updates the cache", async () => {
    const kr = [Buffer.alloc(32, 6), Buffer.alloc(32, 7)];
    const providerId = await persistKeyring(kr);
    expect(providerId).toBe("key-file");
    expect(getCachedKeyring()).toEqual(kr);

    const onDisk = await new KeyFileProvider().getKeyring();
    expect(onDisk![0]!.equals(kr[0]!)).toBe(true);
    expect(onDisk![1]!.equals(kr[1]!)).toBe(true);
  });

  it("refreshKeyring() re-reads the provider chain and picks up out-of-band changes", async () => {
    await initMasterKey();
    expect(getCachedKeyring()).toBeNull();

    const rotatedKey = Buffer.alloc(32, 8);
    await new KeyFileProvider().setKeyring([rotatedKey]);

    const refreshed = await refreshKeyring();
    expect(refreshed![0]!.equals(rotatedKey)).toBe(true);
    expect(getCachedKeyring()![0]!.equals(rotatedKey)).toBe(true);
  });

  it("refreshKeyring() debounces back-to-back calls within the window", async () => {
    const provider = new KeyFileProvider();
    await provider.setKeyring([Buffer.alloc(32, 1)]);
    await initMasterKey();

    const first = await refreshKeyring(); // establishes lastRefreshAt
    expect(first![0]!.equals(Buffer.alloc(32, 1))).toBe(true);

    // Change the backing file out from under the cache, then refresh again
    // immediately — the debounce window should suppress the re-read.
    await provider.setKeyring([Buffer.alloc(32, 2)]);
    const second = await refreshKeyring();
    expect(second![0]!.equals(Buffer.alloc(32, 1))).toBe(true); // still the old value
  });

  it("refreshKeyring() singleflights concurrent callers", async () => {
    await new KeyFileProvider().setKeyring([Buffer.alloc(32, 4)]);
    await initMasterKey();

    // Force a fresh (non-debounced) refresh window isn't guaranteed here, but
    // concurrent calls must still resolve to the same value either way.
    const [a, b] = await Promise.all([refreshKeyring(), refreshKeyring()]);
    expect(a).toEqual(b);
  });

  it("masterKeyFilePath sits outside the state dir", () => {
    expect(masterKeyFilePath()).toBe(path.join(process.env.HEKU_STATE_DIR!, "..", "master.key"));
  });
});
