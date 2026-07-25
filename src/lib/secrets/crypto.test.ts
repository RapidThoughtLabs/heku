import { describe, it, expect } from "vitest";
import {
  encryptValue,
  decryptValue,
  decryptWithKeyring,
  isEncrypted,
  generateMasterKey,
} from "./crypto.js";

const AAD = "github:GITHUB_TOKEN";

describe("generateMasterKey", () => {
  it("returns 32 random bytes and never repeats", () => {
    const a = generateMasterKey();
    const b = generateMasterKey();
    expect(a.length).toBe(32);
    expect(a.equals(b)).toBe(false);
  });
});

describe("isEncrypted", () => {
  it("recognizes the enc:v1: prefix", () => {
    expect(isEncrypted("enc:v1:abc123")).toBe(true);
  });

  it("rejects plaintext and near-miss prefixes", () => {
    expect(isEncrypted("ghp_xxx")).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("enc:v2:abc")).toBe(false);
    expect(isEncrypted("ENC:V1:abc")).toBe(false);
  });
});

describe("encryptValue / decryptValue — round trip", () => {
  it("round-trips a plaintext value", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "ghp_supersecret", AAD);
    expect(isEncrypted(encoded)).toBe(true);
    expect(decryptValue(key, encoded, AAD)).toBe("ghp_supersecret");
  });

  it("round-trips an empty string", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "", AAD);
    expect(decryptValue(key, encoded, AAD)).toBe("");
  });

  it("round-trips unicode content", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "pässwörd-🔑-秘密", AAD);
    expect(decryptValue(key, encoded, AAD)).toBe("pässwörd-🔑-秘密");
  });

  it("produces a different ciphertext every time (random IV)", () => {
    const key = generateMasterKey();
    const a = encryptValue(key, "same-plaintext", AAD);
    const b = encryptValue(key, "same-plaintext", AAD);
    expect(a).not.toBe(b);
    expect(decryptValue(key, a, AAD)).toBe("same-plaintext");
    expect(decryptValue(key, b, AAD)).toBe("same-plaintext");
  });

  it("rejects a key of the wrong length", () => {
    expect(() => encryptValue(Buffer.alloc(16), "x", AAD)).toThrow(/32 bytes/);
  });
});

describe("decryptValue — tamper detection", () => {
  it("throws when the wrong key is used", () => {
    const key = generateMasterKey();
    const wrongKey = generateMasterKey();
    const encoded = encryptValue(key, "secret", AAD);
    expect(() => decryptValue(wrongKey, encoded, AAD)).toThrow();
  });

  it("throws when a ciphertext byte is flipped", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "secret", AAD);
    const raw = Buffer.from(encoded.slice("enc:v1:".length), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff; // flip a byte inside the auth tag
    const tampered = "enc:v1:" + raw.toString("base64");
    expect(() => decryptValue(key, tampered, AAD)).toThrow();
  });

  it("throws on a value that isn't enc:v1 at all", () => {
    const key = generateMasterKey();
    expect(() => decryptValue(key, "plain-value", AAD)).toThrow(/not in enc:v1 format/);
  });

  it("throws on a truncated blob", () => {
    const key = generateMasterKey();
    expect(() => decryptValue(key, "enc:v1:" + Buffer.from("short").toString("base64"), AAD)).toThrow();
  });
});

describe("decryptValue — AAD binding", () => {
  it("throws when decrypted under a different AAD (moved to the wrong slot)", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "slack-token", "slack:SLACK_TOKEN");
    expect(() => decryptValue(key, encoded, "github:GITHUB_TOKEN")).toThrow();
  });

  it("throws when the var name within the same config changes", () => {
    const key = generateMasterKey();
    const encoded = encryptValue(key, "value", "github:TOKEN_A");
    expect(() => decryptValue(key, encoded, "github:TOKEN_B")).toThrow();
  });
});

describe("decryptWithKeyring", () => {
  it("decrypts with the current (first) key", () => {
    const current = generateMasterKey();
    const previous = generateMasterKey();
    const encoded = encryptValue(current, "secret", AAD);
    expect(decryptWithKeyring([current, previous], encoded, AAD)).toBe("secret");
  });

  it("falls back to the previous key when current can't authenticate", () => {
    const current = generateMasterKey();
    const previous = generateMasterKey();
    const encoded = encryptValue(previous, "secret", AAD); // written before rotation
    expect(decryptWithKeyring([current, previous], encoded, AAD)).toBe("secret");
  });

  it("throws only when every key in the keyring fails", () => {
    const current = generateMasterKey();
    const previous = generateMasterKey();
    const unrelated = generateMasterKey();
    const encoded = encryptValue(unrelated, "secret", AAD);
    expect(() => decryptWithKeyring([current, previous], encoded, AAD)).toThrow();
  });

  it("throws a clear error on an empty keyring", () => {
    const encoded = encryptValue(generateMasterKey(), "secret", AAD);
    expect(() => decryptWithKeyring([], encoded, AAD)).toThrow();
  });
});
