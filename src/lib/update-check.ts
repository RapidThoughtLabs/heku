/**
 * Background update checker.
 *
 * Queries the npm registry for the latest published version and prints a
 * one-time notice to stderr if a newer version is available. Results are
 * cached for 24 hours so the network is hit at most once per day.
 *
 * All output goes to stderr — safe to call in MCP stdio mode.
 * All errors are silently swallowed — update checks must never crash the CLI.
 */

import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { VERSION, PKG_NAME } from "./version.js";

const CACHE_FILE = path.join(os.homedir(), ".heku", "update-check.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CacheData {
  checkedAt: number;
  latestVersion: string;
}

function readCache(): CacheData | null {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8")) as CacheData;
  } catch {
    return null;
  }
}

function writeCache(latestVersion: string): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(
      CACHE_FILE,
      JSON.stringify({ checkedAt: Date.now(), latestVersion }),
      "utf-8",
    );
  } catch {
    // ignore write errors
  }
}

export function fetchLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      `https://registry.npmjs.org/${PKG_NAME}/latest`,
      { headers: { Accept: "application/json" } },
      (res) => {
        let data = "";
        res.on("data", (chunk: string) => { data += chunk; });
        res.on("end", () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`npm registry returned HTTP ${res.statusCode}`));
              return;
            }
            const json = JSON.parse(data) as { version?: string };
            if (!json.version) {
              reject(new Error("npm registry response missing version field"));
              return;
            }
            resolve(json.version);
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

/** Returns true if semver `a` is strictly greater than `b`. */
export function semverGt(a: string, b: string): boolean {
  const parse = (v: string) => v.replace(/[^0-9.]/g, "").split(".").map(Number);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return true;
    if (na < nb) return false;
  }
  return false;
}

function printUpdateNotice(latestVersion: string): void {
  const line1 = `  Update available: ${VERSION} → ${latestVersion}`;
  const line2 = `  Run: npm install -g ${PKG_NAME}@latest`;
  const width = Math.max(line1.length, line2.length) + 2;
  const bar = "─".repeat(width);
  process.stderr.write(
    `\n┌${bar}┐\n│${line1.padEnd(width)}│\n│${line2.padEnd(width)}│\n└${bar}┘\n\n`,
  );
}

/**
 * Fire-and-forget background update check. Never blocks, never throws.
 * Prints an update notice to stderr if a newer version is available.
 */
export function checkForUpdate(): void {
  const cache = readCache();

  // Serve from cache if fresh and valid
  if (cache && typeof cache.latestVersion === "string" && cache.latestVersion.length > 0
      && Date.now() - cache.checkedAt < CACHE_TTL_MS) {
    if (semverGt(cache.latestVersion, VERSION)) {
      printUpdateNotice(cache.latestVersion);
    }
    return;
  }

  // Background fetch — fire and forget
  fetchLatestVersion()
    .then((latest) => {
      writeCache(latest);
      if (semverGt(latest, VERSION)) {
        printUpdateNotice(latest);
      }
    })
    .catch(() => {
      // Network errors are silent — never interrupt the user
    });
}
