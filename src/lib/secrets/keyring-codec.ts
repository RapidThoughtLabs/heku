/** [current] or [current, previous] master key, 32 bytes each. Depth capped at 2. */
export type Keyring = Buffer[];

interface KeyringBlobV1 {
  v: 1;
  keys: string[]; // base64, current first
}

/** Serialize a keyring to the single JSON blob persisted per backend (§3.1). */
export function encodeKeyring(kr: Keyring): string {
  const blob: KeyringBlobV1 = { v: 1, keys: kr.map((k) => k.toString("base64")) };
  return JSON.stringify(blob);
}

/** Parse a persisted keyring blob back into Buffers. Depth is capped at 2. */
export function decodeKeyring(blob: string): Keyring {
  let parsed: unknown;
  try {
    parsed = JSON.parse(blob);
  } catch {
    throw new Error("master-key blob is not valid JSON");
  }
  const candidate = parsed as Partial<KeyringBlobV1> | null;
  if (!candidate || candidate.v !== 1 || !Array.isArray(candidate.keys) || candidate.keys.length === 0) {
    throw new Error("unrecognized master-key blob format");
  }
  return candidate.keys.slice(0, 2).map((k) => Buffer.from(k, "base64"));
}
