// ── Placeholder URL Detection ──────────────────────────────────────
// Configs pulled from the registry often ship with placeholder base URLs
// that the user must replace with their actual domain/endpoint.

const PLACEHOLDER_PATTERNS: RegExp[] = [
  /your-domain/i,
  /example\.com/i,
  /placeholder/i,
  /YOUR_[A-Z]/,       // e.g. YOUR_DOMAIN, YOUR_TENANT
  /\{[^}]+\}/,        // template vars: {domain}, {tenant}
  /<[^>]+>/,          // angle-bracket placeholders: <your-domain>
];

/**
 * Returns true if `url` looks like a registry placeholder that the user
 * needs to replace before the service will work.
 *
 * @example
 * isPlaceholderUrl("https://your-domain.atlassian.net/rest/api/3") // true
 * isPlaceholderUrl("https://api.github.com")                       // false
 */
export function isPlaceholderUrl(url: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}
