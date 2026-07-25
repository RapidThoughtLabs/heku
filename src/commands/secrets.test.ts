import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  __setProvidersForTesting,
  __getProvidersForTesting,
  getCachedKeyring,
  initMasterKey,
} from "../lib/secrets/master-key.js";
import type { MasterKeyProvider } from "../lib/secrets/master-key.js";
import { EnvVarProvider } from "../lib/secrets/providers/env-var.js";
import { KeyFileProvider } from "../lib/secrets/providers/key-file.js";
import { decryptValue, encryptValue, isEncrypted } from "../lib/secrets/crypto.js";
import { writeConfigEnv } from "../lib/env-writer.js";
import { runRotate, mapWithConcurrency } from "./secrets.js";

const ENV_KEY = "HEKU_MASTER_KEY";

describe("mapWithConcurrency", () => {
  it("processes every item exactly once and preserves result order", async () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const results = await mapWithConcurrency(items, 5, async (i) => i * 2);
    expect(results).toEqual(items.map((i) => i * 2));
  });

  it("never runs more than `limit` callbacks concurrently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);
    await mapWithConcurrency(items, 4, async (i) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      return i;
    });
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });

  it("handles an empty item list without invoking the callback", async () => {
    const fn = vi.fn(async (x: number) => x);
    const results = await mapWithConcurrency([], 5, fn);
    expect(results).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("runRotate", () => {
  class ExitError extends Error {
    constructor(readonly code: string | number | null | undefined) {
      super(`process.exit(${code})`);
    }
  }

  const originalEnv = { stateDir: process.env.HEKU_STATE_DIR, key: process.env[ENV_KEY] };
  let tmpRoot: string;
  let configDir: string;
  let originalProviders: MasterKeyProvider[];
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heku-rotate-test-"));
    process.env.HEKU_STATE_DIR = path.join(tmpRoot, "state");
    configDir = path.join(tmpRoot, "configs");
    fs.mkdirSync(configDir, { recursive: true });
    delete process.env[ENV_KEY];

    // Real KeyFileProvider against a tmp dir, never a real OS keychain (§Test isolation).
    originalProviders = __getProvidersForTesting();
    __setProvidersForTesting([new EnvVarProvider(), new KeyFileProvider()]);

    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?: string | number | null): never => {
      throw new ExitError(code);
    });
  });

  afterEach(() => {
    if (originalEnv.stateDir === undefined) delete process.env.HEKU_STATE_DIR;
    else process.env.HEKU_STATE_DIR = originalEnv.stateDir;
    if (originalEnv.key === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = originalEnv.key;
    __setProvidersForTesting(originalProviders);
    exitSpy.mockRestore();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("exits 1 when no master key is loaded", async () => {
    await initMasterKey();
    expect(getCachedKeyring()).toBeNull();

    await expect(runRotate(configDir)).rejects.toThrow(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("refuses to rotate under the read-only env-var provider", async () => {
    process.env[ENV_KEY] = Buffer.alloc(32, 1).toString("base64");
    await initMasterKey();
    expect(getCachedKeyring()).not.toBeNull();

    await expect(runRotate(configDir)).rejects.toThrow(ExitError);
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("does nothing, and mints no new key, when there are no env files", async () => {
    const kf = new KeyFileProvider();
    const k0 = Buffer.alloc(32, 2);
    await kf.setKeyring([k0]);
    await initMasterKey();

    await runRotate(configDir);

    const onDisk = await kf.getKeyring();
    expect(onDisk).toHaveLength(1);
    expect(onDisk![0]!.equals(k0)).toBe(true);
  });

  it("rotates encrypted values to a new key, leaves plaintext alone, and retains the previous key", async () => {
    const kf = new KeyFileProvider();
    const k0 = Buffer.alloc(32, 3);
    await kf.setKeyring([k0]);
    await initMasterKey();

    await writeConfigEnv(configDir, "github", [{ key: "GITHUB_TOKEN", value: "secret-abc" }]);
    await writeConfigEnv(configDir, "slack", [{ key: "SLACK_TOKEN", value: "secret-xyz" }]);
    const slackPath = path.join(configDir, "mcp.slack.env");
    fs.appendFileSync(slackPath, "SLACK_CHANNEL=general\n");

    await runRotate(configDir);

    const rotated = await kf.getKeyring();
    expect(rotated).toHaveLength(2);
    expect(rotated![1]!.equals(k0)).toBe(true); // old key retained as "previous"
    const k1 = rotated![0]!;
    expect(k1.equals(k0)).toBe(false);

    const githubContent = fs.readFileSync(path.join(configDir, "mcp.github.env"), "utf-8");
    const githubValue = githubContent.match(/GITHUB_TOKEN=(\S+)/)![1]!;
    expect(isEncrypted(githubValue)).toBe(true);
    expect(decryptValue(k1, githubValue, "github:GITHUB_TOKEN")).toBe("secret-abc");
    expect(() => decryptValue(k0, githubValue, "github:GITHUB_TOKEN")).toThrow();

    const slackContent = fs.readFileSync(slackPath, "utf-8");
    expect(slackContent).toContain("SLACK_CHANNEL=general\n"); // plaintext untouched byte-for-byte
    const slackValue = slackContent.match(/SLACK_TOKEN=(\S+)/)![1]!;
    expect(decryptValue(k1, slackValue, "slack:SLACK_TOKEN")).toBe("secret-xyz");
  });

  it("finishes a straggler left by a crashed rotation before minting a new key", async () => {
    const kf = new KeyFileProvider();
    const k0 = Buffer.alloc(32, 4);
    await kf.setKeyring([k0]);
    await initMasterKey();

    await writeConfigEnv(configDir, "svc-a", [{ key: "TOKEN_A", value: "value-a" }]);
    await writeConfigEnv(configDir, "svc-b", [{ key: "TOKEN_B", value: "value-b" }]);

    await runRotate(configDir); // rotation #1: k0 -> k1
    const afterFirst = await kf.getKeyring();
    const k1 = afterFirst![0]!;

    // Simulate a crash mid-rewrite: the persisted keyring already reflects the
    // completed rotation ([k1, k0]), but svc-b's file never got rewritten and is
    // still under k0 — exactly the "mid-rewrite" row of §12.3's crash table.
    const bPath = path.join(configDir, "mcp.svc-b.env");
    const strayCiphertext = encryptValue(k0, "value-b", "svc-b:TOKEN_B");
    fs.writeFileSync(bPath, `# heku secrets for svc-b\nTOKEN_B=${strayCiphertext}\n`, "utf-8");

    await initMasterKey(); // a resuming instance would re-read the persisted [k1, k0] keyring
    await runRotate(configDir); // rotation #2: preflight must fix svc-b onto k1 before minting k2

    const afterSecond = await kf.getKeyring();
    expect(afterSecond).toHaveLength(2);
    const k2 = afterSecond![0]!;
    expect(afterSecond![1]!.equals(k1)).toBe(true); // k0 was correctly retired, not kept around

    const bContent = fs.readFileSync(bPath, "utf-8");
    const bValue = bContent.match(/TOKEN_B=(\S+)/)![1]!;
    expect(decryptValue(k2, bValue, "svc-b:TOKEN_B")).toBe("value-b"); // straggler survived, not lost
    expect(() => decryptValue(k0, bValue, "svc-b:TOKEN_B")).toThrow(); // k0 fully retired
  });
});
