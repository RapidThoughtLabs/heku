/**
 * heku publish [file]
 *
 * Publishes a local McpConfig JSON file to the registry.
 * The registry decides the action (created / versioned / forked) based on whether
 * the slug already exists under the authenticated user's namespace.
 */

import fs   from "node:fs";
import path from "node:path";
import {
  publish,
  RegistryError,
} from "../registry/client.js";
import { loadCredentials, getRegistry, addToManifest, loadManifest } from "../registry/auth.js";
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

  if (!cfg.id)   throw new Error(`Config is missing required field: "id"`);
  if (!cfg.name) throw new Error(`Config is missing required field: "name"`);
  if (!cfg.connector?.type) throw new Error(`Config is missing required field: "connector.type"`);
  if (!Array.isArray(cfg.tools)) throw new Error(`Config is missing required field: "tools" (must be an array)`);

  const ID_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;
  if (!ID_RE.test(cfg.id)) {
    throw new Error(
      `Invalid "id": "${cfg.id}" — must match ^[a-z0-9][a-z0-9-]*[a-z0-9]$ ` +
      `(lowercase alphanumeric and hyphens, no leading/trailing hyphens)`,
    );
  }

  if (cfg.connector.type === "mcp") {
    throw new Error(
      `Cannot publish MCP connector configs — these wrap local MCP servers and are not portable.\n` +
      `Only http, cli, file, grpc, and graphql connector types can be published.`,
    );
  }

  for (let i = 0; i < cfg.tools.length; i++) {
    const t = cfg.tools[i];
    if (!t.name)        throw new Error(`tools[${i}] is missing required field: "name"`);
    if (!t.description) throw new Error(`tools[${i}] is missing required field: "description"`);
    if (!Array.isArray(t.params)) throw new Error(`tools[${i}] is missing required field: "params" (must be an array)`);
  }

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

function toSlug(baseId: string): string {
  return baseId.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
}

async function resolveConfigFileByArg(configDir: string, fileArg: string): Promise<string> {
  if (path.isAbsolute(fileArg) || fileArg.includes(path.sep) || fileArg.includes("/")) {
    return path.resolve(fileArg);
  }

  let stem = fileArg;
  if (stem.endsWith(".json")) stem = stem.slice(0, -".json".length);
  if (stem.startsWith("mcp.")) stem = stem.slice("mcp.".length);

  const exact = path.join(configDir, `mcp.${stem}.json`);
  if (fs.existsSync(exact)) return exact;

  const { base: stemBase, connectorType: stemConnector } = extractBaseAndConnector(stem);
  const searchBase      = stemConnector !== "unknown" ? stemBase : stem;
  const filterConnector = stemConnector !== "unknown" ? stemConnector : null;

  const variants: Array<{ connector: string; file: string }> = [];
  if (fs.existsSync(configDir)) {
    const baseFile = path.join(configDir, `mcp.${searchBase}.json`);
    if (fs.existsSync(baseFile)) {
      try {
        const raw = JSON.parse(fs.readFileSync(baseFile, "utf-8")) as { connector?: { type?: string } };
        const ct  = raw?.connector?.type ?? "unknown";
        variants.push({ connector: ct, file: baseFile });
      } catch { /* ignore malformed file */ }
    }
    for (const ct of CONNECTOR_TYPES) {
      const candidate = path.join(configDir, `mcp.${searchBase}-${ct}.json`);
      if (fs.existsSync(candidate)) variants.push({ connector: ct, file: candidate });
    }
  }

  const candidates = filterConnector ? variants.filter((v) => v.connector === filterConnector) : variants;

  if (candidates.length === 0) {
    const label = filterConnector ? `${searchBase} (connector: ${filterConnector})` : searchBase;
    throw new Error(
      `No config found for "${label}". Expected ${dim(`mcp-configs/mcp.${searchBase}-<connector>.json`)} ` +
      `(valid connectors: ${CONNECTOR_TYPES.join(", ")}).`,
    );
  }

  if (candidates.length === 1) return candidates[0].file;

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

// ── main ──────────────────────────────────────────────────────────────

export async function run(args: string[]): Promise<void> {
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  const fileArg = args.find((a, i) => {
    if (a.startsWith("--")) return false;
    if (registryFlag !== -1 && i === registryFlag + 1) return false;
    return true;
  });

  const creds = loadCredentials(registryName);
  if (!creds) {
    console.error(
      red("✗") +
      ` Not logged in. Run: ${bold("heku login")}` +
      (registryName !== "default" ? ` --registry ${registryName}` : ""),
    );
    process.exit(1);
  }

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
    let candidates: string[] = [];
    if (fs.existsSync(configDir)) {
      candidates = fs.readdirSync(configDir)
        .filter((f) => f.startsWith("mcp.") && f.endsWith(".json") && f !== "mcp.one.json")
        .map((f) => path.join(configDir, f));
    }
    if (candidates.length === 0) {
      console.error(red("✗") + ` No config file found. Try: ${bold("heku publish <name>")}`);
      process.exit(1);
    }
    if (candidates.length > 1) {
      console.error(
        red("✗") +
        ` Multiple configs found — specify which one:\n` +
        candidates.map((c) => `  ${dim(path.basename(c, ".json").replace(/^mcp\./, ""))}`).join("\n") +
        `\n\n  Usage: ${bold("heku publish <name>")}`,
      );
      process.exit(1);
    }
    filePath = candidates[0];
  }

  let config: McpConfig;
  try {
    config = loadConfigFile(filePath);
  } catch (err) {
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }

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

  const { base: baseId } = extractBaseAndConnector(config.id);
  const slug = toSlug(baseId);

  // Resolve target from manifest: installed configs carry the original qualified_slug
  // ("@ruchit/github:http"). Strip the connector suffix to get the publish target.
  // Registry compares target.namespace to the auth token actor:
  //   same namespace  → VERSION
  //   diff namespace  → FORK
  //   no target       → CREATE
  const manifestEntry = loadManifest().installed.find((e) => {
    const withoutNs = e.slug.replace(/^@[^/]+\//, "");
    const colon     = withoutNs.indexOf(":");
    if (colon === -1) return false;
    return `${withoutNs.slice(0, colon)}-${withoutNs.slice(colon + 1)}` === config.id
      && e.registry === registryName;
  });
  const target = manifestEntry ? manifestEntry.slug.replace(/:.*$/, "") : undefined;

  console.log();
  console.log(bold("  Publishing to mcp.rtl.space"));
  console.log();
  console.log(`  Config:    ${bold(config.name)} ${dim(`(${config.id})`)}`);
  console.log(`  Connector: ${config.connector.type}`);
  if (config.api_version) console.log(`  API ver:   ${config.api_version}`);
  if (target) console.log(`  Target:    ${dim(target)}`);
  console.log();

  const description = await ask(`Description ${dim(`(default: ${config.description ?? "none"})`)}: `);
  const category    = await ask(`Category    ${dim("(e.g. development, productivity, data)")}: `);
  const tagsRaw     = await ask(`Tags        ${dim("(comma-separated, optional)")}: `);
  const tags        = tagsRaw.split(",").map((t) => t.trim()).filter(Boolean);

  const visibilityRaw = await ask(`Visibility  ${dim("(public/private, default: public)")}: `);
  const visibility    = (visibilityRaw.trim() === "private" ? "private" : "public") as "public" | "private";

  const message = await ask(`Message     ${dim("(optional changelog note)")}: `);

  const defaultNamespace = creds.username ?? "";
  const displayTarget    = target ?? `@${defaultNamespace}/${slug}`;

  const ok = await confirm(yellow("?") + `  Publish ${bold(displayTarget)}? (y/n): `);
  if (!ok) {
    console.log(dim("  Aborted."));
    process.exit(0);
  }

  console.log();
  process.stdout.write(`  Publishing ${bold(displayTarget)}... `);

  try {
    const result = await publish({
      target,
      slug:           target ? undefined : slug,
      name:           config.name,
      description:    description.trim() || config.description || "",
      category:       category.trim(),
      connector_type: config.connector.type,
      visibility,
      tags,
      payload:        config,
      message:        message.trim() || undefined,
    }, registryName);

    addToManifest(result.config.qualified_slug, result.version.version, result.config.connector_type, registryName);
    console.log(green("done"));
    console.log();

    const actionLabel =
      result.action === "created"   ? green("✓") + " Created"  :
      result.action === "versioned" ? green("✓") + " Updated"  :
                                      green("✓") + " Forked as";

    console.log(`${actionLabel} ${bold(cyan(result.config.qualified_slug))} @ ${bold(`v${result.version.version}`)}`);
    if (result.action !== "forked") {
      console.log(dim(`  ${getRegistryUrl(registryName)}/${defaultNamespace}/${slug}`));
    }
    if (result.warnings?.length) {
      for (const w of result.warnings) console.log(yellow("⚠") + `  ${w}`);
    }
    console.log();

  } catch (err) {
    console.log(red("failed"));
    console.error(red("✗") + ` ${(err as Error).message}`);
    if (err instanceof RegistryError && err.body) {
      console.error(dim(JSON.stringify(err.body, null, 2)));
    }
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
