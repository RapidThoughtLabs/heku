import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { LinuxSecretToolProvider } from "./linux-secret-tool.js";
import { encodeKeyring } from "../keyring-codec.js";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./which.js", () => ({ isOnPath: vi.fn() }));

import { isOnPath } from "./which.js";

interface SpawnBehavior {
  stdout?: string;
  code?: number | null;
  error?: Error;
}

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdinWrites: string[] = [];
  readonly stdin = {
    write: (chunk: string): boolean => {
      this.stdinWrites.push(chunk);
      return true;
    },
    end: (): void => {
      queueMicrotask(() => {
        if (this.behavior.error) {
          this.emit("error", this.behavior.error);
          return;
        }
        if (this.behavior.stdout !== undefined) this.stdout.emit("data", Buffer.from(this.behavior.stdout));
        this.emit("close", this.behavior.code ?? 0);
      });
    },
  };
  constructor(private readonly behavior: SpawnBehavior) {
    super();
  }
}

function mockSpawnOnce(behavior: SpawnBehavior = {}): FakeChild {
  const child = new FakeChild(behavior);
  vi.mocked(spawn).mockReturnValueOnce(child as never);
  return child;
}

describe("LinuxSecretToolProvider", () => {
  const original = { platform: process.platform, dbus: process.env.DBUS_SESSION_BUS_ADDRESS };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=/run/user/1000/bus";
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: original.platform, configurable: true });
    if (original.dbus === undefined) delete process.env.DBUS_SESSION_BUS_ADDRESS;
    else process.env.DBUS_SESSION_BUS_ADDRESS = original.dbus;
  });

  describe("isAvailable", () => {
    it("is false off linux", async () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new LinuxSecretToolProvider().isAvailable()).toBe(false);
    });

    it("is false without a session bus (headless/CI/Docker)", async () => {
      delete process.env.DBUS_SESSION_BUS_ADDRESS;
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new LinuxSecretToolProvider().isAvailable()).toBe(false);
    });

    it("is false when secret-tool isn't on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(false);
      expect(await new LinuxSecretToolProvider().isAvailable()).toBe(false);
    });

    it("is true with a session bus and secret-tool on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new LinuxSecretToolProvider().isAvailable()).toBe(true);
    });
  });

  describe("getKeyring", () => {
    it("returns null when the item isn't found", async () => {
      mockSpawnOnce({ code: 1 });
      expect(await new LinuxSecretToolProvider().getKeyring()).toBeNull();
    });

    it("decodes the stored blob back into a keyring", async () => {
      const key = Buffer.alloc(32, 3);
      const blob = encodeKeyring([key]);
      mockSpawnOnce({ stdout: Buffer.from(blob, "utf-8").toString("base64"), code: 0 });

      const kr = await new LinuxSecretToolProvider().getKeyring();
      expect(kr![0]!.equals(key)).toBe(true);
    });

    it("rejects (letting the caller fall through) when secret-tool can't spawn", async () => {
      mockSpawnOnce({ error: Object.assign(new Error("spawn secret-tool ENOENT"), { code: "ENOENT" }) });
      await expect(new LinuxSecretToolProvider().getKeyring()).rejects.toThrow(/ENOENT/);
    });
  });

  describe("setKeyring", () => {
    it("sends the secret via stdin, never as an argv entry", async () => {
      const child = mockSpawnOnce({ code: 0 });
      await new LinuxSecretToolProvider().setKeyring([Buffer.alloc(32, 4)]);

      const [cmd, args] = vi.mocked(spawn).mock.calls[0]!;
      expect(cmd).toBe("secret-tool");
      expect(args).toEqual(["store", "--label=heku master key", "service", "heku", "key", "master"]);
      // The stored value never appears as one of the argv tokens.
      expect(args).not.toContain(child.stdinWrites.join(""));
    });

    it("round-trips the exact keyring blob through what it writes to stdin", async () => {
      const key = Buffer.alloc(32, 2);
      const child = mockSpawnOnce({ code: 0 });
      await new LinuxSecretToolProvider().setKeyring([key]);

      const roundTripped = Buffer.from(child.stdinWrites.join(""), "base64").toString("utf-8");
      expect(JSON.parse(roundTripped)).toEqual({ v: 1, keys: [key.toString("base64")] });
    });

    it("throws when secret-tool exits non-zero", async () => {
      mockSpawnOnce({ code: 1 });
      await expect(new LinuxSecretToolProvider().setKeyring([Buffer.alloc(32)])).rejects.toThrow(/exit code 1/);
    });
  });
});
