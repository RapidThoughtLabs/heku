// Build-time constants set by tsup define (see tsup.config.ts).
// In dev (tsx), read from package.json at runtime so the version is accurate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

function readPkgVersion(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(dir, "../../package.json"), "utf-8");
    return (JSON.parse(raw) as { version: string }).version;
  } catch {
    return "0.0.0-dev";
  }
}

export const VERSION: string =
  typeof __HEKU_VERSION__ !== "undefined" ? __HEKU_VERSION__ : readPkgVersion();

export const PKG_NAME: string =
  typeof __HEKU_NAME__ !== "undefined" ? __HEKU_NAME__ : "@rapidthoughtlabs/heku";
