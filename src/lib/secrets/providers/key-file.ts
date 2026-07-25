import fs from "node:fs";
import path from "node:path";
import type { MasterKeyProvider } from "../master-key.js";
import type { Keyring } from "../keyring-codec.js";
import { encodeKeyring, decodeKeyring } from "../keyring-codec.js";
import { masterKeyFilePath } from "../../paths.js";

/**
 * Last-resort provider: `~/.heku/master.key`, mode 0600. Always available —
 * this is what makes headless / Docker / CI setups work with zero keychain.
 */
export class KeyFileProvider implements MasterKeyProvider {
  readonly id = "key-file";
  readonly writable = true;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getKeyring(): Promise<Keyring | null> {
    const fp = masterKeyFilePath();
    if (!fs.existsSync(fp)) return null;
    const blob = fs.readFileSync(fp, "utf-8");
    return decodeKeyring(blob);
  }

  async setKeyring(kr: Keyring): Promise<void> {
    const fp = masterKeyFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    const blob = encodeKeyring(kr);
    const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, blob, "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, fp);
  }

  /** Atomic O_EXCL create — used by ensureKeyring() genesis so the first writer wins. */
  async createExclusive(kr: Keyring): Promise<boolean> {
    const fp = masterKeyFilePath();
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    let fd: number;
    try {
      fd = fs.openSync(fp, "wx", 0o600); // O_WRONLY|O_CREAT|O_EXCL
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
    try {
      fs.writeFileSync(fd, encodeKeyring(kr), "utf-8");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return true;
  }
}
