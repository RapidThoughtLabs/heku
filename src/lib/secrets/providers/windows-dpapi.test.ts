import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { WindowsDpapiProvider } from "./windows-dpapi.js";
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

describe("WindowsDpapiProvider", () => {
  const original = { platform: process.platform, stateDir: process.env.HEKU_STATE_DIR };
  let tmpDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-dpapi-test-"));
    process.env.HEKU_STATE_DIR = path.join(tmpDir, "state");
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: original.platform, configurable: true });
    if (original.stateDir === undefined) delete process.env.HEKU_STATE_DIR;
    else process.env.HEKU_STATE_DIR = original.stateDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("isAvailable", () => {
    it("is false off win32", async () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new WindowsDpapiProvider().isAvailable()).toBe(false);
    });

    it("is false when powershell isn't on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(false);
      expect(await new WindowsDpapiProvider().isAvailable()).toBe(false);
    });

    it("is true on win32 with powershell on PATH", async () => {
      vi.mocked(isOnPath).mockReturnValue(true);
      expect(await new WindowsDpapiProvider().isAvailable()).toBe(true);
    });
  });

  describe("getKeyring", () => {
    it("returns null (and never spawns) when no dpapi file exists yet", async () => {
      expect(await new WindowsDpapiProvider().getKeyring()).toBeNull();
      expect(vi.mocked(spawn)).not.toHaveBeenCalled();
    });

    it("throws when PowerShell exits non-zero", async () => {
      fs.writeFileSync(path.join(tmpDir, "master.key.dpapi"), "some-ciphertext", "utf-8");
      mockSpawnOnce({ code: 1 });
      await expect(new WindowsDpapiProvider().getKeyring()).rejects.toThrow(/DPAPI unprotect failed/);
    });
  });

  describe("setKeyring", () => {
    it("pipes plaintext via stdin (never argv) and stores only ciphertext on disk", async () => {
      const key = Buffer.alloc(32, 6);
      const fakeCiphertext = Buffer.from("pretend-dpapi-ciphertext").toString("base64");
      const child = mockSpawnOnce({ stdout: fakeCiphertext, code: 0 });

      await new WindowsDpapiProvider().setKeyring([key]);

      const [cmd, args] = vi.mocked(spawn).mock.calls[0]!;
      expect(cmd).toBe("powershell");
      expect(args).toContain("-Command");
      expect(args.join(" ")).not.toContain(key.toString("base64")); // key material never on argv

      const plainB64 = Buffer.from(encodeKeyring([key]), "utf-8").toString("base64");
      expect(child.stdinWrites.join("")).toBe(plainB64);

      const onDisk = fs.readFileSync(path.join(tmpDir, "master.key.dpapi"), "utf-8");
      expect(onDisk).toBe(fakeCiphertext); // plaintext blob never touches disk, only DPAPI output does
    });

    it("writes the dpapi file with mode 0600", async () => {
      mockSpawnOnce({ stdout: "ciphertext", code: 0 });
      await new WindowsDpapiProvider().setKeyring([Buffer.alloc(32, 1)]);
      const mode = fs.statSync(path.join(tmpDir, "master.key.dpapi")).mode & 0o777;
      expect(mode).toBe(0o600);
    });

    it("throws when PowerShell exits non-zero", async () => {
      mockSpawnOnce({ code: 1 });
      await expect(new WindowsDpapiProvider().setKeyring([Buffer.alloc(32)])).rejects.toThrow(/DPAPI protect failed/);
    });
  });

  it("round-trips a keyring through setKeyring then getKeyring with mocked Protect/Unprotect", async () => {
    const key = Buffer.alloc(32, 8);
    const cipherB64 = Buffer.from("fake-ciphertext").toString("base64");

    mockSpawnOnce({ stdout: cipherB64, code: 0 }); // Protect, inside setKeyring
    await new WindowsDpapiProvider().setKeyring([key]);

    const plainB64 = Buffer.from(encodeKeyring([key]), "utf-8").toString("base64");
    mockSpawnOnce({ stdout: plainB64, code: 0 }); // Unprotect, inside getKeyring

    const kr = await new WindowsDpapiProvider().getKeyring();
    expect(kr![0]!.equals(key)).toBe(true);
  });
});
