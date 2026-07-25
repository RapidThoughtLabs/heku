import type { MasterKeyProvider } from "../master-key.js";
import type { Keyring } from "../keyring-codec.js";
import { NotWritableError } from "../errors.js";

const ENV_KEY = "HEKU_MASTER_KEY";
const ENV_KEY_PREVIOUS = "HEKU_MASTER_KEY_PREVIOUS";

/**
 * Reads the master key from `HEKU_MASTER_KEY` (+ optional `HEKU_MASTER_KEY_PREVIOUS`),
 * both raw base64. First in selection order so CI/Docker/K8s always wins over any
 * keychain. Read-only — platform-managed rotation injects new env vars rather than
 * heku rewriting them.
 */
export class EnvVarProvider implements MasterKeyProvider {
  readonly id = "env-var";
  readonly writable = false;

  async isAvailable(): Promise<boolean> {
    return !!process.env[ENV_KEY];
  }

  async getKeyring(): Promise<Keyring | null> {
    const current = process.env[ENV_KEY];
    if (!current) return null;
    const keyring: Keyring = [Buffer.from(current, "base64")];
    const previous = process.env[ENV_KEY_PREVIOUS];
    if (previous) keyring.push(Buffer.from(previous, "base64"));
    return keyring;
  }

  async setKeyring(_kr: Keyring): Promise<void> {
    throw new NotWritableError(this.id);
  }
}
