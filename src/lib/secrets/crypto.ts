// AES-256-GCM envelope encryption for per-config secret values. node:crypto only, zero deps.
import crypto from "node:crypto";
import type { Keyring } from "./keyring-codec.js";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "enc:v1:";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/** Generate a fresh 32-byte master key. */
export function generateMasterKey(): Buffer {
  return crypto.randomBytes(KEY_LENGTH);
}

/** True if `value` is in the `enc:v1:` wire format. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}

/**
 * Encrypt a single value under `key`, bound to `aad` (typically `${configId}:${varName}`).
 * Returns the `enc:v1:` wire-format string: base64(iv || ciphertext || authTag).
 */
export function encryptValue(key: Buffer, plaintext: string, aad: string): string {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`master key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(aad, "utf-8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt an `enc:v1:` value under `key`, verifying it was bound to `aad`.
 * Throws if the value isn't `enc:v1:`, is malformed, or fails the GCM tag check
 * (wrong key, tampered ciphertext, or moved to the wrong config/var slot).
 */
export function decryptValue(key: Buffer, encoded: string, aad: string): string {
  if (!isEncrypted(encoded)) {
    throw new Error("value is not in enc:v1 format");
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error(`master key must be ${KEY_LENGTH} bytes, got ${key.length}`);
  }
  const blob = Buffer.from(encoded.slice(PREFIX.length), "base64");
  if (blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error("encrypted value is too short");
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(blob.length - TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAAD(Buffer.from(aad, "utf-8"));
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf-8");
}

/**
 * Decrypt against each key in the keyring in order (current, then previous).
 * The wire format carries no key id — the first key whose GCM tag authenticates wins.
 * Throws only when every key in the keyring fails.
 */
export function decryptWithKeyring(kr: Keyring, encoded: string, aad: string): string {
  let lastErr: unknown;
  for (const key of kr) {
    try {
      return decryptValue(key, encoded, aad);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new Error("decryption failed: keyring is empty");
}

export type { Keyring } from "./keyring-codec.js";
