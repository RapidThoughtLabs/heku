import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { KeyFileProvider } from "./key-file.js";
import { masterKeyFilePath } from "../../paths.js";

describe("KeyFileProvider", () => {
  const originalStateDir = process.env.HEKU_STATE_DIR;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-keyfile-test-"));
    // Nested + not-yet-created so tests can verify setKeyring makes parent dirs.
    process.env.HEKU_STATE_DIR = path.join(tmpDir, "nested", "state");
  });

  afterEach(() => {
    if (originalStateDir === undefined) delete process.env.HEKU_STATE_DIR;
    else process.env.HEKU_STATE_DIR = originalStateDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is always available and read-write", async () => {
    const provider = new KeyFileProvider();
    expect(await provider.isAvailable()).toBe(true);
    expect(provider.writable).toBe(true);
    expect(provider.id).toBe("key-file");
  });

  it("returns null when no file exists yet", async () => {
    const provider = new KeyFileProvider();
    expect(await provider.getKeyring()).toBeNull();
  });

  it("round-trips a keyring through setKeyring/getKeyring", async () => {
    const provider = new KeyFileProvider();
    const current = Buffer.alloc(32, 9);
    const previous = Buffer.alloc(32, 3);
    await provider.setKeyring([current, previous]);

    const kr = await provider.getKeyring();
    expect(kr).toHaveLength(2);
    expect(kr![0]!.equals(current)).toBe(true);
    expect(kr![1]!.equals(previous)).toBe(true);
  });

  it("writes the file with mode 0600", async () => {
    const provider = new KeyFileProvider();
    await provider.setKeyring([Buffer.alloc(32, 1)]);
    const mode = fs.statSync(masterKeyFilePath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("createExclusive succeeds when no file exists", async () => {
    const provider = new KeyFileProvider();
    const key: Buffer[] = [Buffer.alloc(32, 5)];
    const won = await provider.createExclusive(key);
    expect(won).toBe(true);
    expect((await provider.getKeyring())![0]!.equals(key[0]!)).toBe(true);
  });

  it("createExclusive fails without clobbering when a file already exists (genesis race)", async () => {
    const provider = new KeyFileProvider();
    const winner = [Buffer.alloc(32, 1)];
    const loser = [Buffer.alloc(32, 2)];

    expect(await provider.createExclusive(winner)).toBe(true);
    expect(await provider.createExclusive(loser)).toBe(false);

    // File on disk must still be the winner's key — the loser never touched it.
    const kr = await provider.getKeyring();
    expect(kr![0]!.equals(winner[0]!)).toBe(true);
  });

  it("setKeyring creates parent directories as needed", async () => {
    const provider = new KeyFileProvider();
    expect(fs.existsSync(path.dirname(masterKeyFilePath()))).toBe(false);
    await provider.setKeyring([Buffer.alloc(32, 4)]);
    expect(fs.existsSync(masterKeyFilePath())).toBe(true);
  });
});
