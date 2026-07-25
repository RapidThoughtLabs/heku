import { describe, it, expect } from "vitest";
import { encodeKeyring, decodeKeyring } from "./keyring-codec.js";

describe("encodeKeyring / decodeKeyring", () => {
  it("round-trips a single-key keyring", () => {
    const key = Buffer.from("0".repeat(64), "hex"); // 32 bytes
    const decoded = decodeKeyring(encodeKeyring([key]));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]!.equals(key)).toBe(true);
  });

  it("round-trips a two-key keyring in order (current first)", () => {
    const current = Buffer.from("1".repeat(64), "hex");
    const previous = Buffer.from("2".repeat(64), "hex");
    const decoded = decodeKeyring(encodeKeyring([current, previous]));
    expect(decoded).toHaveLength(2);
    expect(decoded[0]!.equals(current)).toBe(true);
    expect(decoded[1]!.equals(previous)).toBe(true);
  });

  it("caps depth at 2 even if given more", () => {
    const keys = [Buffer.from("a".repeat(64), "hex"), Buffer.from("b".repeat(64), "hex"), Buffer.from("c".repeat(64), "hex")];
    const decoded = decodeKeyring(encodeKeyring(keys));
    expect(decoded).toHaveLength(2);
  });

  it("persists as a single JSON blob (v1 envelope)", () => {
    const blob = encodeKeyring([Buffer.from("d".repeat(64), "hex")]);
    const parsed = JSON.parse(blob) as { v: number; keys: string[] };
    expect(parsed.v).toBe(1);
    expect(Array.isArray(parsed.keys)).toBe(true);
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeKeyring("not json")).toThrow();
  });

  it("rejects a recognizable-but-wrong-shape blob", () => {
    expect(() => decodeKeyring(JSON.stringify({ v: 2, keys: ["x"] }))).toThrow();
    expect(() => decodeKeyring(JSON.stringify({ v: 1 }))).toThrow();
    expect(() => decodeKeyring(JSON.stringify({ v: 1, keys: [] }))).toThrow();
  });
});
