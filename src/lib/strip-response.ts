/**
 * strip-response — structural trimming of upstream tool responses.
 *
 * Removes things that carry no information regardless of intent: base64 blobs,
 * null/empty containers, oversized strings/arrays. Never picks which field
 * "matters" — that's the intent-aware scoring pass (Phase 3).
 */

export interface StripOptions {
  /** Strings >= this many chars that look like base64 become a handle. */
  blobMinLen: number;
  /** Opaque strings longer than this are truncated with a marker. */
  maxStringLen: number;
  /** How much of an over-long string to keep before the marker. */
  stringHeadLen: number;
  /** Arrays longer than this are truncated to first N + a marker. */
  maxArrayLen: number;
  /** Safety guard against pathologically deep / cyclic structures. */
  maxDepth: number;
}

export const DEFAULT_STRIP_OPTIONS: StripOptions = {
  blobMinLen: 1024,
  maxStringLen: 8000,
  stringHeadLen: 512,
  maxArrayLen: 100,
  maxDepth: 64,
};

const BASE64_RE = /^[A-Za-z0-9+/\r\n]+={0,2}$/;

function looksLikeBase64(s: string, minLen: number): boolean {
  if (s.length < minLen) return false;
  if (s.startsWith("data:")) return true;
  const compact = s.replace(/[\r\n]/g, "");
  if (compact.length % 4 !== 0) return false;
  return BASE64_RE.test(s);
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}

function approxBytes(s: string): number {
  const b64 = s.startsWith("data:") ? (s.split(",", 2)[1] ?? "") : s;
  return Math.floor((b64.replace(/[\r\n]/g, "").length * 3) / 4);
}

function stripValue(value: unknown, opts: StripOptions, depth: number): unknown {
  if (depth > opts.maxDepth) return value;

  if (typeof value === "string") {
    if (looksLikeBase64(value, opts.blobMinLen)) {
      return { _heku: "binary-omitted", encoding: "base64", bytes: approxBytes(value) };
    }
    if (value.length > opts.maxStringLen) {
      const omitted = value.length - opts.stringHeadLen;
      return `${value.slice(0, opts.stringHeadLen)}⟦heku: +${omitted} chars truncated⟧`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, opts.maxArrayLen).map((v) => stripValue(v, opts, depth + 1));
    if (value.length > opts.maxArrayLen) {
      kept.push({ _heku: "array-truncated", shown: opts.maxArrayLen, total: value.length });
    }
    return kept;
  }

  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isEmpty(v)) continue;
      out[k] = stripValue(v, opts, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Return a structurally-trimmed copy of a tool response. Pure: never mutates
 * the input. Idempotent: stripping already-stripped data is a no-op.
 */
export function stripResponse(data: unknown, opts: StripOptions = DEFAULT_STRIP_OPTIONS): unknown {
  return stripValue(data, opts, 0);
}
