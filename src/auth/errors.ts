// ── Auth Errors ───────────────────────────────────────────────────

/**
 * Thrown by auth handlers when one or more required environment variables
 * are missing. Caught in executor.ts to produce a structured JSON error
 * instead of a raw exception message.
 */
export class AuthNotConfiguredError extends Error {
  constructor(
    public readonly configId: string,
    public readonly authType: string,
    public readonly missingVars: string[],
  ) {
    super(`Auth not configured for "${configId}": missing ${missingVars.join(", ")}`);
    this.name = "AuthNotConfiguredError";
  }
}
