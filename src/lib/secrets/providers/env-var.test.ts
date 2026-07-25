import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvVarProvider } from "./env-var.js";
import { NotWritableError } from "../errors.js";

const ENV_KEY = "HEKU_MASTER_KEY";
const ENV_KEY_PREVIOUS = "HEKU_MASTER_KEY_PREVIOUS";

describe("EnvVarProvider", () => {
  const original = { current: process.env[ENV_KEY], previous: process.env[ENV_KEY_PREVIOUS] };

  beforeEach(() => {
    delete process.env[ENV_KEY];
    delete process.env[ENV_KEY_PREVIOUS];
  });

  afterEach(() => {
    if (original.current === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original.current;
    if (original.previous === undefined) delete process.env[ENV_KEY_PREVIOUS];
    else process.env[ENV_KEY_PREVIOUS] = original.previous;
  });

  it("is read-only", () => {
    const provider = new EnvVarProvider();
    expect(provider.writable).toBe(false);
    expect(provider.id).toBe("env-var");
  });

  it("is unavailable when HEKU_MASTER_KEY is unset", async () => {
    const provider = new EnvVarProvider();
    expect(await provider.isAvailable()).toBe(false);
    expect(await provider.getKeyring()).toBeNull();
  });

  it("reads a single key from HEKU_MASTER_KEY", async () => {
    const key = Buffer.alloc(32, 7);
    process.env[ENV_KEY] = key.toString("base64");

    const provider = new EnvVarProvider();
    expect(await provider.isAvailable()).toBe(true);
    const kr = await provider.getKeyring();
    expect(kr).toHaveLength(1);
    expect(kr![0]!.equals(key)).toBe(true);
  });

  it("reads current + previous when both are set", async () => {
    const current = Buffer.alloc(32, 1);
    const previous = Buffer.alloc(32, 2);
    process.env[ENV_KEY] = current.toString("base64");
    process.env[ENV_KEY_PREVIOUS] = previous.toString("base64");

    const provider = new EnvVarProvider();
    const kr = await provider.getKeyring();
    expect(kr).toHaveLength(2);
    expect(kr![0]!.equals(current)).toBe(true);
    expect(kr![1]!.equals(previous)).toBe(true);
  });

  it("ignores HEKU_MASTER_KEY_PREVIOUS when current is unset", async () => {
    process.env[ENV_KEY_PREVIOUS] = Buffer.alloc(32, 2).toString("base64");
    const provider = new EnvVarProvider();
    expect(await provider.getKeyring()).toBeNull();
  });

  it("rejects writes", async () => {
    const provider = new EnvVarProvider();
    await expect(provider.setKeyring([Buffer.alloc(32)])).rejects.toThrow(NotWritableError);
  });
});
