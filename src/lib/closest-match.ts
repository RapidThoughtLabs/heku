/**
 * Tiny Levenshtein-based "did you mean" helper for short identifiers
 * (connector type suffixes, command names, etc.).
 */

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

/**
 * Pick the closest match from `options` to `needle`. Returns undefined when
 * the best candidate is too far away to be a useful suggestion.
 *
 * Threshold: max(2, floor(needle.length / 2)) — generous for short strings
 * like "htp" → "http" but stops nonsense suggestions on long inputs.
 */
export function closestConnector(
  needle: string,
  options: string[],
): string | undefined {
  if (!needle || options.length === 0) return undefined;

  const lower = needle.toLowerCase();
  let best: string | undefined;
  let bestDist = Infinity;

  for (const opt of options) {
    const d = levenshtein(lower, opt.toLowerCase());
    if (d < bestDist) {
      best = opt;
      bestDist = d;
    }
  }

  const threshold = Math.max(2, Math.floor(needle.length / 2));
  return best && bestDist <= threshold ? best : undefined;
}
