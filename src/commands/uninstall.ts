/**
 * mcp-one uninstall <target>
 *
 * Removes a registry-installed config from mcp-configs/ and the local manifest.
 *
 * Target formats:
 *   @ns/slug                — bare (prompts if multiple variants installed locally)
 *   @ns/slug:connector      — fully qualified variant
 *   ns/slug                 — leading @ is optional
 *
 * Flags:
 *   --registry <n>          Limit to a non-default registry (default: "default")
 */

import fs   from "node:fs";
import path from "node:path";
import {
  getInstalledEntriesByBareName,
  getInstalledEntry,
  removeFromManifest,
  type ManifestEntry,
} from "../registry/auth.js";
import { loadSystemConfig } from "../system-config.js";
import { resolveConfigDir } from "../lib/resolve-config-dir.js";
import { pick } from "../lib/picker.js";
import { bold, green, red, cyan, dim, yellow } from "../lib/fmt.js";

// ── Target parser (same shape as install, minus version) ──────────

function parseTarget(target: string): {
  namespace: string;
  rawSlug: string;
  connectorType?: string;
} {
  const cleaned = target.startsWith("@") ? target.slice(1) : target;

  const slashIdx = cleaned.indexOf("/");
  if (slashIdx === -1 || slashIdx === 0 || slashIdx === cleaned.length - 1) {
    throw new Error(
      `Invalid target "${target}". Expected: @ns/slug  or  @ns/slug:connector`,
    );
  }

  const namespace = cleaned.slice(0, slashIdx);
  const rest      = cleaned.slice(slashIdx + 1);

  const colonIdx = rest.indexOf(":");
  let rawSlug: string;
  let connectorType: string | undefined;

  if (colonIdx !== -1) {
    rawSlug       = rest.slice(0, colonIdx);
    connectorType = rest.slice(colonIdx + 1) || undefined;
  } else {
    rawSlug = rest;
  }

  if (!namespace || !rawSlug) {
    throw new Error(
      `Invalid target "${target}". Expected: @ns/slug  or  @ns/slug:connector`,
    );
  }

  return { namespace, rawSlug, connectorType };
}

// ── Local-state resolution (handles bare-slug ambiguity) ─────────

async function resolveInstalledEntry(
  namespace: string,
  rawSlug: string,
  connectorType: string | undefined,
  registry: string,
  displayTarget: string,
): Promise<ManifestEntry> {
  const bareSlug = `@${namespace}/${rawSlug}`;

  // Fully-qualified — exact lookup.
  if (connectorType) {
    const qualified = `${bareSlug}:${connectorType}`;
    const entry = getInstalledEntry(qualified, registry);
    if (!entry) {
      console.error(red("✗") + `  "${qualified}" is not installed.`);
      console.error(`  Run ${bold("mcp-one list")} to see installed configs.`);
      process.exit(1);
    }
    return entry;
  }

  // Bare — find all installed variants under this namespace/slug.
  const entries = getInstalledEntriesByBareName(bareSlug, registry);

  if (entries.length === 0) {
    console.error(red("✗") + `  "${displayTarget}" is not installed.`);
    console.error(`  Run ${bold("mcp-one list")} to see installed configs.`);
    process.exit(1);
  }

  if (entries.length === 1) return entries[0];

  // >1 → picker (or non-TTY fallback).
  const picked = await pick(
    `"${displayTarget}" has multiple installed variants — pick one to uninstall:`,
    entries.map((e) => ({
      label: cyan(e.slug),
      hint:  `${e.connector_type} · v${e.version}`,
      value: e,
    })),
  );

  if (picked === null) {
    console.log();
    console.error(yellow("⚠") + `  "${displayTarget}" matches multiple installed variants.`);
    console.error(`  Installed: ${entries.map((e) => e.slug).join(", ")}`);
    console.error(`  Pick one, e.g.:`);
    for (const e of entries.slice(0, 3)) {
      console.error(`    mcp-one uninstall ${e.slug}`);
    }
    process.exit(1);
  }

  return picked;
}

// ── Entry point ───────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  const registryIdx = args.indexOf("--registry");
  const registry    = registryIdx !== -1 ? args[registryIdx + 1] : "default";

  const skipIndices = new Set<number>();
  if (registryIdx !== -1) { skipIndices.add(registryIdx); skipIndices.add(registryIdx + 1); }

  const target = args.find((a, i) => !skipIndices.has(i) && !a.startsWith("--"));

  if (!target) {
    console.error(
      red("✗") + ` Usage: ${bold("mcp-one uninstall <target>")}` +
      `\n  Examples:` +
      `\n    mcp-one uninstall @rtl/context7-api` +
      `\n    mcp-one uninstall @rtl/github:http`,
    );
    process.exit(1);
  }

  const systemConfig = loadSystemConfig(process.cwd());
  const configDir    = resolveConfigDir(undefined, systemConfig);

  let parsed: ReturnType<typeof parseTarget>;
  try {
    parsed = parseTarget(target);
  } catch (err) {
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }

  const { namespace, rawSlug, connectorType } = parsed;
  const displayTarget = `@${namespace}/${rawSlug}${connectorType ? `:${connectorType}` : ""}`;

  console.log();
  console.log(bold("  Uninstalling"));
  console.log();
  console.log(`  Target:   ${bold(cyan(displayTarget))}`);
  if (registry !== "default") {
    console.log(`  Registry: ${dim(registry)}`);
  }
  console.log();

  const entry = await resolveInstalledEntry(
    namespace, rawSlug, connectorType, registry, displayTarget,
  );

  // Compound id mirrors install.ts: {rawSlug}-{connector_type}
  const installedId = `${rawSlug}-${entry.connector_type}`;
  const outFile     = path.join(configDir, `mcp.${installedId}.json`);

  let fileRemoved = false;
  if (fs.existsSync(outFile)) {
    try {
      fs.unlinkSync(outFile);
      fileRemoved = true;
    } catch (err) {
      console.error(red("✗") + `  Failed to remove config file: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  removeFromManifest(entry.slug, registry);

  console.log(
    green("✓") +
    ` Uninstalled ${bold(cyan(entry.slug))} ${dim(`(was v${entry.version})`)}`,
  );
  console.log(dim(`  Config id: ${installedId}`));
  if (fileRemoved) {
    console.log(dim(`  Removed:   ${outFile}`));
  } else {
    console.log(dim(`  No file at ${outFile} — manifest entry cleared.`));
  }
  console.log();
  console.log(dim("  Server will hot-reload and drop the tools automatically."));
  console.log();
}
