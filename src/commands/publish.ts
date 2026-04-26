/**
 * mcp-one publish [file]
 *
 * Publishes a local McpConfig JSON file to the registry.
 *
 * Flow:
 *   1. Resolve the config file path
 *   2. Parse + validate the payload (client-side guards)
 *   3. POST /configs/  →  201 done  |  409 slug exists → publish new version
 *   4. Print result with registry URL
 *
 * Client-side guards (before any network call):
 *   - connector.type must not be "mcp" (MCP configs are local-only)
 *   - namespace must match the authenticated user's username
 */

import fs   from "node:fs";
import path from "node:path";
import {
  publishNew,
  publishVersion,
  RegistryError,
  type PublishNewPayload,
} from "../registry/client.js";
import { loadCredentials, getRegistry, addToManifest } from "../registry/auth.js";
import { ask, confirm } from "../lib/prompt.js";
import { bold, green, red, dim, cyan, yellow } from "../lib/fmt.js";
import { CONNECTOR_TYPES, extractBaseAndConnector, isConnectorType } from "../lib/connector-types.js";
import type { McpConfig } from "../types.js";

// ── helpers ───────────────────────────────────────────────────────────

function loadConfigFile(filePath: string): McpConfig {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${filePath}`);
  }

  const cfg = parsed as McpConfig;

  // Minimal required fields
  if (!cfg.id)   throw new Error(`Config is missing required field: "id"`);
  if (!cfg.name) throw new Error(`Config is missing required field: "name"`);
  if (!cfg.connector?.type) throw new Error(`Config is missing required field: "connector.type"`);
  if (!Array.isArray(cfg.tools)) throw new Error(`Config is missing required field: "tools" (must be an array)`);

  // id must match server-side regex
  const ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (!ID_RE.test(cfg.id)) {
    throw new Error(
      `Invalid "id": "${cfg.id}" — must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ` +
      `(lowercase alphanumeric and hyphens, no leading/trailing hyphens)`,
    );
  }

  // MCP connector configs are local-only — never uploadable
  if (cfg.connector.type === "mcp") {
    throw new Error(
      `Cannot publish MCP connector configs — these wrap local MCP servers and are not portable.\n` +
      `Only http, cli, file, grpc, and graphql connector types can be published.`,
    );
  }

  // Each tool must have name, description, and params array
  for (let i = 0; i < cfg.tools.length; i++) {
    const t = cfg.tools[i];
    if (!t.name)        throw new Error(`tools[${i}] is missing required field: "name"`);
    if (!t.description) throw new Error(`tools[${i}] is missing required field: "description"`);
    if (!Array.isArray(t.params)) throw new Error(`tools[${i}] is missing required field: "params" (must be an array)`);
  }

  // Compound-id convention: id must end with "-{connector.type}" where connector.type is a known suffix.
  // This keeps filename, id field, and connector.type in lockstep — same convention that install uses.
  const { base, connectorType: idConnector } = extractBaseAndConnector(cfg.id);
  if (idConnector === "unknown") {
    throw new Error(
      `Config id "${cfg.id}" does not follow the connector-suffix convention.\n` +
      `Rename the id to "${cfg.id}-${cfg.connector.type}" and the file to "mcp.${cfg.id}-${cfg.connector.type}.json" ` +
      `(valid suffixes: ${CONNECTOR_TYPES.join(", ")}).`,
    );
  }
  if (idConnector !== cfg.connector.type) {
    throw new Error(
      `Connector mismatch: id "${cfg.id}" ends with "-${idConnector}" but connector.type is "${cfg.connector.type}". ` +
      `Rename the id to "${base}-${cfg.connector.type}" (or switch the connector back).`,
    );
  }

  return cfg;
}

/** Derive a URL-safe slug from a base id (connector suffix already stripped). */
function toSlug(baseId: string): string {
  return baseId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Resolve the local config file for a `publish <arg>` invocation.
 *
 * Resolution precedence:
 *   1. `<arg>` with a path separator / absolute → treat as a direct path.
 *   2. `mcp-configs/mcp.<arg>.json` exists exactly → use it.
 *   3. Collect ALL candidates for the base name:
 *      - `mcp.<base>.json`                          (non-suffixed legacy file)
 *      - `mcp.<base>-{connector}.json` for each ct  (convention-following files)
 *      If <arg> already includes a connector suffix (e.g. "context7-http"),
 *      only candidates whose connector.type matches are kept.
 *      1 match → use it silently. >1 → picker.
 */
async function resolveConfigFileByArg(configDir: string, fileArg: string): Promise<string> {
  // (1) explicit path
  if (path.isAbsolute(fileArg) || fileArg.includes(path.sep) || fileArg.includes("/")) {
    return path.resolve(fileArg);
  }

  // Normalise: strip "mcp." prefix and ".json" suffix so callers can pass any of:
  //   github-http, mcp.github-http, mcp.github-http.json
  let stem = fileArg;
  if (stem.endsWith(".json")) stem = stem.slice(0, -".json".length);
  if (stem.startsWith("mcp.")) stem = stem.slice("mcp.".length);

  // (2) exact match — already fully qualified (e.g. "github-http")
  const exact = path.join(configDir, `mcp.${stem}.json`);
  if (fs.existsSync(exact)) return exact;

  // Determine the base name and optional connector filter.
  // "context7-http" → base="context7", filterConnector="http"
  // "context7"      → base="context7", filterConnector=null
  const { base: stemBase, connectorType: stemConnector } = extractBaseAndConnector(stem);
  const searchBase      = stemConnector !== "unknown" ? stemBase : stem;
  const filterConnector = stemConnector !== "unknown" ? stemConnector : null;

  // (3) collect all candidates for this base
  const variants: Array<{ connector: string; file: string }> = [];
  if (fs.existsSync(configDir)) {
    // Non-suffixed base file — peek at connector.type from inside the JSON
    const baseFile = path.join(configDir, `mcp.${searchBase}.json`);
    if (fs.existsSync(baseFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(baseFile, "utf-8")) as { connector?: { type?: string } };
        const ct  = raw?.connector?.type ?? "unknown";
        variants.push({ connector: ct, file: baseFile });
      } catch { /* ignore malformed file — loadConfigFile will surface the error */ }
    }
    // Convention-following suffixed variants
    for (const ct of CONNECTOR_TYPES) {
      const candidate = path.join(configDir, `mcp.${searchBase}-${ct}.json`);
      if (fs.existsSync(candidate)) variants.push({ connector: ct, file: candidate });
    }
  }

  // Apply connector filter when the user specified one (e.g. "context7-http")
  const candidates = filterConnector ? variants.filter((v) => v.connector === filterConnector) : variants;

  if (candidates.length === 0) {
    const label = filterConnector ? `${searchBase} (connector: ${filterConnector})` : searchBase;
    throw new Error(
      `No config found for "${label}". Expected ${dim(`mcp-configs/mcp.${searchBase}-<connector>.json`)} ` +
      `(valid connectors: ${CONNECTOR_TYPES.join(", ")}).`,
    );
  }

  if (candidates.length === 1) {
    return candidates[0].file;
  }

  // Multiple variants — prompt the user to pick.
  console.log();
  console.log(`  ${bold(searchBase)} has ${candidates.length} connector variants:`);
  for (const v of candidates) console.log(`    - ${v.connector}`);
  console.log();
  const pick = await ask(`  Which connector? ${dim(`(${candidates.map((v) => v.connector).join(" / ")})`)}: `);
  const picked = pick.trim().toLowerCase();

  if (!isConnectorType(picked)) {
    throw new Error(`Invalid connector "${pick}". Choose one of: ${candidates.map((v) => v.connector).join(", ")}`);
  }
  const chosen = candidates.find((v) => v.connector === picked);
  if (!chosen) {
    throw new Error(`No "${picked}" variant for "${searchBase}". Available: ${candidates.map((v) => v.connector).join(", ")}`);
  }
  return chosen.file;
}

/** Prompt the user for a namespace, defaulting to their authenticated username. */
async function resolveNamespace(defaultNs: string): Promise<string> {
  const input = await ask(`Namespace ${dim(`(default: ${defaultNs})`)}: `);
  const ns = input.trim() || defaultNs;
  return ns.replace(/^@/, ""); // strip @ — server stores without it
}

// ── main ──────────────────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  // Parse flags
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  // Find the file argument (first non-flag arg)
  const fileArg = args.find((a, i) => {
    if (a.startsWith("--")) return false;
    if (registryFlag !== -1 && i === registryFlag + 1) return false;
    return true;
  });

  // ── 1. Auth check ─────────────────────────────────────────────────
  const creds = loadCredentials(registryName);
  if (!creds) {
    console.error(
      red("✗") +
      ` Not logged in. Run: ${bold("mcp-one login")}` +
      (registryName !== "default" ? ` --registry ${registryName}` : ""),
    );
    process.exit(1);
  }

  // ── 2. Resolve config file ────────────────────────────────────────
  const configDir = path.join(process.cwd(), "mcp-configs");

  let filePath: string;
  if (fileArg) {
    try {
      filePath = await resolveConfigFileByArg(configDir, fileArg);
    } catch (err) {
      console.error(red("✗") + ` ${(err as Error).message}`);
      process.exit(1);
    }
  } else {
    // Auto-detect: look for mcp.*.json files in mcp-configs/, excluding mcp.one.json
    let candidates: string[] = [];
    if (fs.existsSync(configDir)) {
      candidates = fs.readdirSync(configDir)
        .filter((f) => f.startsWith("mcp.") && f.endsWith(".json") && f !== "mcp.one.json")
        .map((f) => path.join(configDir, f));
    }
    if (candidates.length === 0) {
      console.error(red("✗") + ` No config file found. Try: ${bold("mcp-one publish <name>")}`);
      process.exit(1);
    }
    if (candidates.length > 1) {
      console.error(
        red("✗") +
        ` Multiple configs found — specify which one:\n` +
        candidates.map((c) => `  ${dim(path.basename(c, ".json").replace(/^mcp\./, ""))}`).join("\n") +
        `\n\n  Usage: ${bold("mcp-one publish <name>")}`,
      );
      process.exit(1);
    }
    filePath = candidates[0];
  }

  // ── 3. Load + validate payload ────────────────────────────────────
  let config: McpConfig;
  try {
    config = loadConfigFile(filePath);
  } catch (err) {
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }

  // Filename ↔ payload consistency: the file must be named mcp.<id>.json.
  const expectedBase = `mcp.${config.id}.json`;
  const actualBase   = path.basename(filePath);
  if (actualBase !== expectedBase) {
    console.error(
      red("✗") +
      ` Filename/id mismatch: ${dim(actualBase)} but config.id is "${config.id}" ` +
      `(expected ${dim(expectedBase)}).`,
    );
    process.exit(1);
  }

  // Slug sent to the registry is the BASE id (connector suffix stripped) — the server
  // stores connector_type separately and composes the qualified slug on its side.
  const { base: baseId } = extractBaseAndConnector(config.id);
  const slug = toSlug(baseId);
  const defaultNamespace = creds.username ?? "";

  console.log();
  console.log(bold("  Publishing to mcp.rtl.space"));
  console.log();
  console.log(`  Config:    ${bold(config.name)} ${dim(`(${config.id})`)}`);
  console.log(`  Connector: ${config.connector.type}`);
  if (config.api_version) {
    console.log(`  API ver:   ${config.api_version}`);
  }
  console.log();

  // ── 4. Collect publish metadata ───────────────────────────────────
  const namespace = await resolveNamespace(defaultNamespace);

  // Enforce namespace ownership
  if (namespace !== defaultNamespace.replace(/^@/, "")) {
    const ok = await confirm(
      yellow("⚠") +
      `  Namespace "${namespace}" doesn't match your username "${defaultNamespace}". Continue anyway? (y/n): `,
    );
    if (!ok) {
      console.log(dim("  Aborted."));
      process.exit(0);
    }
  }

  const description = await ask(`Description ${dim(`(default: ${config.description ?? "none"})`)}: `);
  const category    = await ask(`Category    ${dim("(e.g. development, productivity, data)")}: `);
  const tagsRaw     = await ask(`Tags        ${dim("(comma-separated, optional)")}: `);
  const tags        = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);

  const visibilityRaw = await ask(`Visibility  ${dim("(public/private, default: public)")}: `);
  const visibility    = (visibilityRaw.trim() === "private" ? "private" : "public") as "public" | "private";

  const message = await ask(`Message     ${dim("(optional changelog note)")}: `);

  const payload: PublishNewPayload = {
    namespace,
    slug,
    name:           config.name,
    description:    description.trim() || config.description || "",
    category:       category.trim(),
    connector_type: config.connector.type,
    visibility,
    tags,
    payload:        config,
    message:        message.trim(),
  };

  // ── 5. Publish ────────────────────────────────────────────────────
  console.log();
  process.stdout.write(`  Publishing ${bold(`${namespace}/${slug}`)}... `);

  try {
    const result = await publishNew(payload, registryName);
    // D8: use qualified_slug and connector_type from the registry response
    addToManifest(result.config.qualified_slug, result.version.version, result.config.connector_type, registryName);
    console.log(green("done"));
    console.log();
    console.log(
      green("✓") +
      ` Published ${bold(cyan(`${namespace}/${slug}`))} @ ${bold(result.version.version)}`,
    );
    console.log(dim(`  ${getRegistryUrl(registryName)}/${namespace}/${slug}`));
    console.log();
    return;

  } catch (err) {
    if (err instanceof RegistryError && err.status === 409) {
      // Slug already exists — publish a new version instead
      // D8: 409 body contains existing config meta with qualified_slug and connector_type
      const existingMeta = (err.body as { config?: { qualified_slug?: string; connector_type?: string } } | undefined)?.config;
      const qualifiedSlug  = existingMeta?.qualified_slug ?? `@${namespace}/${slug}:${config.connector.type}`;
      const connectorType  = existingMeta?.connector_type ?? config.connector.type;
      console.log(yellow("already exists"));
      await publishNewVersion(namespace, slug, config, message, qualifiedSlug, connectorType, registryName);
      return;
    }

    console.log(red("failed"));
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }
}

// ── new version flow ──────────────────────────────────────────────────

async function publishNewVersion(
  namespace: string,
  slug:      string,
  config:    McpConfig,
  initialMessage: string,
  qualifiedSlug:  string,
  connectorType:  string,
  registryName: string,
): Promise<void> {
  console.log();
  console.log(`  ${bold(`${namespace}/${slug}`)} already exists in the registry.`);
  console.log(`  Publishing a new version instead.`);
  console.log();

  const version = await ask(`  New version ${dim("(semver, e.g. 1.1.0)")}: `);
  if (!version.trim()) {
    console.error(red("✗") + " Version is required.");
    process.exit(1);
  }

  const message = initialMessage || await ask(`  Changelog message ${dim("(optional)")}: `);

  process.stdout.write(`  Publishing ${bold(`${namespace}/${slug}@${version.trim()}`)}... `);

  try {
    const result = await publishVersion(namespace, slug, {
      version: version.trim(),
      payload: config,
      message: message.trim(),
    }, registryName);

    // D8: qualifiedSlug and connectorType are passed in from the call site
    addToManifest(qualifiedSlug, result.version, connectorType, registryName);
    console.log(green("done"));
    console.log();
    console.log(
      green("✓") +
      ` Published ${bold(cyan(`${namespace}/${slug}`))} @ ${bold(result.version)}`,
    );
    console.log(dim(`  ${getRegistryUrl(registryName)}/${namespace}/${slug}`));
    console.log();
  } catch (err) {
    console.log(red("failed"));
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }
}

function getRegistryUrl(registryName: string): string {
  try {
    return getRegistry(registryName).url;
  } catch {
    return "https://mcp.rapidthoughtlabs.space";
  }
}
