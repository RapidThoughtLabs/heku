import { generateMasterKey } from "./crypto.js";
import { EnvVarProvider } from "./providers/env-var.js";
import { MacOSKeychainProvider } from "./providers/macos-keychain.js";
import { WindowsDpapiProvider } from "./providers/windows-dpapi.js";
import { LinuxSecretToolProvider } from "./providers/linux-secret-tool.js";
import { KeyFileProvider } from "./providers/key-file.js";
import type { Keyring } from "./keyring-codec.js";

export type { Keyring } from "./keyring-codec.js";

export interface MasterKeyProvider {
  /** Human-readable id for `heku secrets status` (e.g. "macos-keychain"). */
  readonly id: string;
  /** False for read-only providers (EnvVarProvider); `setKeyring` rejects when false. */
  readonly writable: boolean;
  /** Retrieve the keyring (current first), or null if not set here. */
  getKeyring(): Promise<Keyring | null>;
  /** Persist the keyring. Rejects with NotWritableError when `writable` is false. */
  setKeyring(kr: Keyring): Promise<void>;
  /** True if this provider can operate in the current environment. */
  isAvailable(): Promise<boolean>;
  /**
   * Optional atomic "create only if absent" primitive used by genesis (§3.1) to make
   * concurrent first-writers converge safely. Providers without an atomic backend
   * primitive omit this — ensureKeyring() falls back to a generic re-read-then-adopt.
   * Returns false if a keyring already existed (caller should adopt it instead).
   */
  createExclusive?(kr: Keyring): Promise<boolean>;
}

// Selection order (§3.2): env var first (so CI/Docker/K8s always wins), then each
// platform's native keychain, then the key file as the universal last resort
// (headless environments, or any keychain adapter unavailable/failing).
let PROVIDERS: MasterKeyProvider[] = [
  new EnvVarProvider(),
  new MacOSKeychainProvider(),
  new WindowsDpapiProvider(),
  new LinuxSecretToolProvider(),
  new KeyFileProvider(),
];

/**
 * Test-only seam: swap the provider chain so orchestration tests never depend on —
 * or mutate — a real OS keychain, regardless of which OS runs the suite. Not part of
 * the package's public API.
 */
export function __setProvidersForTesting(providers: MasterKeyProvider[]): void {
  PROVIDERS = providers;
}

export function __getProvidersForTesting(): MasterKeyProvider[] {
  return PROVIDERS;
}

// ── Module-cached keyring (read path stays synchronous downstream — §6.1) ──────

let cachedKeyring: Keyring | null = null;
let activeProviderId: string | null = null;
let refreshInFlight: Promise<Keyring | null> | null = null;
let lastRefreshAt = 0;
const REFRESH_DEBOUNCE_MS = 2000;

function setCached(kr: Keyring | null, providerId: string | null): void {
  cachedKeyring = kr;
  activeProviderId = providerId;
}

async function selectReadableKeyring(): Promise<{ keyring: Keyring; provider: MasterKeyProvider } | null> {
  for (const provider of PROVIDERS) {
    try {
      if (!(await provider.isAvailable())) continue;
      const kr = await provider.getKeyring();
      if (kr && kr.length > 0) return { keyring: kr, provider };
    } catch (err) {
      console.error(`[heku] master-key provider "${provider.id}" failed: ${(err as Error).message}`);
    }
  }
  return null;
}

/**
 * Try each writable provider in order, attempting `fn` against it. Falls through to
 * the next on any error — a locked macOS keychain over SSH, Windows Constrained
 * Language Mode blocking PowerShell, etc. (§3.2) — logging which provider failed.
 * Throws only once every writable provider has failed or none is available.
 */
async function withFirstWritableProvider<T>(
  fn: (provider: MasterKeyProvider) => Promise<T>,
): Promise<{ result: T; provider: MasterKeyProvider }> {
  let lastErr: Error | null = null;
  for (const provider of PROVIDERS) {
    if (!provider.writable) continue;
    try {
      if (!(await provider.isAvailable())) continue;
      const result = await fn(provider);
      return { result, provider };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      console.error(`[heku] master-key provider "${provider.id}" write failed: ${lastErr.message}`);
    }
  }
  throw lastErr ?? new Error("no writable master-key provider is available");
}

/** Call once at process startup, before any env file is loaded. Never prompts, never creates a key. */
export async function initMasterKey(): Promise<void> {
  const found = await selectReadableKeyring();
  if (found) {
    setCached(found.keyring, found.provider.id);
    console.error(`[heku] master key loaded (provider: "${found.provider.id}")`);
  } else {
    setCached(null, null);
  }
}

/** Synchronous read of the cached keyring — what env-store's decrypt path uses. */
export function getCachedKeyring(): Keyring | null {
  return cachedKeyring;
}

export function getActiveProviderId(): string | null {
  return activeProviderId;
}

/**
 * Re-read the provider chain once and refresh the cache — used on a decrypt miss
 * (another instance may have rotated). Singleflight + debounced (~2s): concurrent
 * callers share one in-flight read, and a read that just completed short-circuits.
 */
export async function refreshKeyring(): Promise<Keyring | null> {
  if (refreshInFlight) return refreshInFlight;
  if (cachedKeyring && Date.now() - lastRefreshAt < REFRESH_DEBOUNCE_MS) return cachedKeyring;

  refreshInFlight = (async () => {
    try {
      const found = await selectReadableKeyring();
      lastRefreshAt = Date.now();
      if (found) setCached(found.keyring, found.provider.id);
      return cachedKeyring;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

/**
 * Unconditionally persist `kr` via the best available writable provider.
 * Used by `secrets init --force` and (later) `secrets rotate`. Not genesis —
 * callers that want adopt-existing semantics should use ensureKeyring() instead.
 */
export async function persistKeyring(kr: Keyring): Promise<string> {
  const { provider } = await withFirstWritableProvider((p) => p.setKeyring(kr));
  setCached(kr, provider.id);
  return provider.id;
}

export interface EnsureKeyringResult {
  keyring: Keyring;
  provider: MasterKeyProvider;
  /** True only if this call actually generated the key; false if it adopted one that already existed. */
  created: boolean;
}

/**
 * Key genesis — opt-in, one-time, adopt-existing (§3.1). Only ever called from
 * single-writer, human-driven paths (`secrets init`, first `auth setup`) — never
 * from `start`. If a keyring already exists anywhere in the provider chain, it is
 * adopted and no new key is generated. Otherwise a fresh key is generated and
 * persisted through the best writable provider; if that provider supports
 * createExclusive(), a concurrent racer safely loses and adopts the winner's key
 * instead of overwriting it.
 */
export async function ensureKeyring(): Promise<EnsureKeyringResult> {
  const existing = await selectReadableKeyring();
  if (existing) {
    setCached(existing.keyring, existing.provider.id);
    return { keyring: existing.keyring, provider: existing.provider, created: false };
  }

  const candidate: Keyring = [generateMasterKey()];

  const { result, provider } = await withFirstWritableProvider(async (p) => {
    if (p.createExclusive) {
      const won = await p.createExclusive(candidate);
      if (won) return { keyring: candidate, created: true };
      // Lost the race — someone else's key is now on disk. Adopt it.
      const adopted = await p.getKeyring();
      if (!adopted) {
        throw new Error(`provider "${p.id}" reported a genesis conflict but no keyring could be read back`);
      }
      return { keyring: adopted, created: false };
    }

    // Generic adopt-existing: re-read immediately before writing to close the race window.
    const raceCheck = await p.getKeyring();
    if (raceCheck) return { keyring: raceCheck, created: false };
    await p.setKeyring(candidate);
    return { keyring: candidate, created: true };
  });

  setCached(result.keyring, provider.id);
  return { keyring: result.keyring, provider, created: result.created };
}
