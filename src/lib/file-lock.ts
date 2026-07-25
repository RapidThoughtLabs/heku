import fs from "node:fs";

// Per-file advisory lock via atomic mkdir — zero deps, identical behavior on
// POSIX and Windows. Used by writeConfigEnv and (later) `heku secrets rotate`
// so writers to the same mcp.{configId}.env serialize instead of clobbering
// each other (§6.4, §12.2).

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;

interface LockOwner {
  pid: number;
  ts: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isLockStale(ownerFile: string): boolean {
  let owner: LockOwner;
  try {
    owner = JSON.parse(fs.readFileSync(ownerFile, "utf-8")) as LockOwner;
  } catch {
    return true; // missing/corrupt owner file — safe to break
  }
  if (Date.now() - owner.ts < LOCK_STALE_MS) return false;
  try {
    process.kill(owner.pid, 0); // signal-0 probe: throws if the pid is dead
    return false;
  } catch {
    return true;
  }
}

/**
 * Acquire an advisory lock on `filePath` (a `{filePath}.lock` directory).
 * Resolves to a release function. Breaks locks whose owner pid is dead and
 * whose age exceeds the stale threshold.
 */
export async function acquireLock(filePath: string): Promise<() => void> {
  const lockDir = `${filePath}.lock`;
  const ownerFile = `${lockDir}/owner.json`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid, ts: Date.now() } satisfies LockOwner), "utf-8");
      return () => {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // already gone — fine
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;

      if (isLockStale(ownerFile)) {
        try {
          fs.rmSync(lockDir, { recursive: true, force: true });
        } catch {
          // lost the race to clear it — just retry below
        }
        continue;
      }

      if (Date.now() > deadline) {
        throw new Error(`timed out waiting for lock on ${filePath}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

/** Write `content` to `filePath` via temp-file → fsync → atomic rename. */
export function atomicWriteFileSync(filePath: string, content: string, mode = 0o600): void {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmpPath, "w", mode);
  try {
    fs.writeFileSync(fd, content, "utf-8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}
