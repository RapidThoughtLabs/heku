import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { MacOSKeychainProvider } from "./macos-keychain.js";
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

describe("MacOSKeychainProvider", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  });

  describe("isAvailable", () => {
    it("is false off darwin even when security is on PATH", async () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new MacOSKeychainProvider().isAvailable()).toBe(false);
    });

    it("is false on darwin when security is not on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(false);
      expect(await new MacOSKeychainProvider().isAvailable()).toBe(false);
    });

    it("is true on darwin with security on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new MacOSKeychainProvider().isAvailable()).toBe(true);
    });
  });

  describe("getKeyring", () => {
    it("returns null when the item isn't found (security exit 44)", async () => {
      mockSpawnOnce({ code: 44 });
      expect(await new MacOSKeychainProvider().getKeyring()).toBeNull();
    });

    it("decodes the stored blob back into a keyring", async () => {
      const key = Buffer.alloc(32, 7);
      const blob = encodeKeyring([key]);
      mockSpawnOnce({ stdout: `${Buffer.from(blob, "utf-8").toString("base64")}\n`, code: 0 });

      const kr = await new MacOSKeychainProvider().getKeyring();
      expect(kr).toHaveLength(1);
      expect(kr![0]!.equals(key)).toBe(true);
    });

    it("rejects (letting the caller fall through) when security itself can't spawn", async () => {
      mockSpawnOnce({ error: Object.assign(new Error("spawn security ENOENT"), { code: "ENOENT" }) });
      await expect(new MacOSKeychainProvider().getKeyring()).rejects.toThrow(/ENOENT/);
    });
  });

  describe("setKeyring", () => {
    it("sends the secret via stdin, never as an argv entry", async () => {
      const child = mockSpawnOnce({ code: 0 });
      const key = Buffer.alloc(32, 5);

      await new MacOSKeychainProvider().setKeyring([key]);

      const [cmd, args] = vi.mocked(spawn).mock.calls[0]!;
      expect(cmd).toBe("security");
      expect(args).toEqual(["-i"]); // no secret material on the argv line

      const written = child.stdinWrites.join("");
      expect(written).toContain("add-generic-password -a heku -s heku-master-key -w ");
      expect(written).toContain(" -U");
    });

    it("round-trips the exact keyring blob through the base64 value it writes", async () => {
      const key = Buffer.alloc(32, 9);
      const child = mockSpawnOnce({ code: 0 });
      await new MacOSKeychainProvider().setKeyring([key]);

      const match = child.stdinWrites.join("").match(/-w (\S+) -U/);
      expect(match).not.toBeNull();
      const roundTripped = Buffer.from(match![1]!, "base64").toString("utf-8");
      expect(JSON.parse(roundTripped)).toEqual({ v: 1, keys: [key.toString("base64")] });
    });

    it("throws when security exits non-zero", async () => {
      mockSpawnOnce({ code: 1 });
      await expect(new MacOSKeychainProvider().setKeyring([Buffer.alloc(32)])).rejects.toThrow(/exit code 1/);
    });
  });
});
