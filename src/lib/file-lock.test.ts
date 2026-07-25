import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, atomicWriteFileSync } from "./file-lock.js";

describe("file-lock", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("acquireLock creates a {file}.lock directory and release() removes it", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-lock-test-"));
    const target = path.join(tmpDir, "mcp.github.env");

    const release = await acquireLock(target);
    expect(fs.existsSync(`${target}.lock`)).toBe(true);

    release();
    expect(fs.existsSync(`${target}.lock`)).toBe(false);
  });

  it("a second acquireLock waits until the first is released", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-lock-test-"));
    const target = path.join(tmpDir, "mcp.github.env");

    const release1 = await acquireLock(target);

    let acquiredSecond = false;
    const p2 = acquireLock(target).then((release2) => {
      acquiredSecond = true;
      release2();
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(acquiredSecond).toBe(false); // still held by the first lock

    release1();
    await p2;
    expect(acquiredSecond).toBe(true);
  });

  it("concurrent writers serialize with no lost update", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-lock-test-"));
    const target = path.join(tmpDir, "mcp.github.env");
    fs.writeFileSync(target, "count=0\n");

    async function incrementUnderLock(): Promise<void> {
      const release = await acquireLock(target);
      try {
        const content = fs.readFileSync(target, "utf-8");
        const current = parseInt(content.match(/count=(\d+)/)![1]!, 10);
        // Yield to let a racing writer interleave if the lock weren't effective.
        await new Promise((r) => setTimeout(r, 5));
        atomicWriteFileSync(target, `count=${current + 1}\n`);
      } finally {
        release();
      }
    }

    await Promise.all(Array.from({ length: 10 }, () => incrementUnderLock()));
    const final = fs.readFileSync(target, "utf-8");
    expect(final).toBe("count=10\n");
  });

  it("breaks a stale lock owned by a dead pid", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-lock-test-"));
    const target = path.join(tmpDir, "mcp.github.env");
    const lockDir = `${target}.lock`;

    fs.mkdirSync(lockDir);
    // A pid that (almost certainly) doesn't exist, with a timestamp old enough to be stale.
    fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({ pid: 999999, ts: Date.now() - 60_000 }));

    const release = await acquireLock(target);
    expect(fs.existsSync(lockDir)).toBe(true); // re-created by the new holder
    release();
  });
});

describe("atomicWriteFileSync", () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes content and leaves no temp file behind", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-atomic-test-"));
    const target = path.join(tmpDir, "out.env");

    atomicWriteFileSync(target, "hello=world\n");

    expect(fs.readFileSync(target, "utf-8")).toBe("hello=world\n");
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toHaveLength(0);
  });

  it("writes with mode 0600 by default", async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "heku-atomic-test-"));
    const target = path.join(tmpDir, "out.env");
    atomicWriteFileSync(target, "x=1\n");
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});
