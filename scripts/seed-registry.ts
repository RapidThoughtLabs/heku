/**
 * seed-registry.ts
 *
 * Publishes the canonical mcp-configs to the mcp.one registry.
 * Run with:  MCP_ONE_TOKEN=<token> npx tsx scripts/seed-registry.ts
 *
 * Flags:
 *   --dry-run   Print what would be published without making requests
 *   --force     Publish a new version even if the config already exists
 *   --slug=x    Only seed the config with this slug
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIGS_DIR = path.join(__dirname, "..", "mcp-configs");
const REGISTRY_URL = process.env.MCP_ONE_REGISTRY_URL ?? "https://mcp.rapidthoughtlabs.space";
const NAMESPACE = "mcp-one";
const VERSION = "0.1.0";

// ── Configs to skip (internal / test / not ready for public) ───────
const SKIP_SLUGS = new Set([
  "one",          // internal — the mcp.one meta-tools config
  "grpc-test",    // test fixture
  "greeter-grpc", // example / test
]);

// ── Category + tag mapping per config slug ──────────────────────────
const META: Record<string, { category: string; tags: string[]; message?: string }> = {
  "github": {
    category: "developer-tools",
    tags: ["github", "git", "repositories", "issues", "pull-requests", "devops"],
    message: "Official GitHub REST API integration — repos, issues, and PRs",
  },
  "slack": {
    category: "communication",
    tags: ["slack", "messaging", "channels", "workspace", "notifications"],
    message: "Official Slack Web API — send messages, list channels, read history",
  },
  "jira": {
    category: "project-management",
    tags: ["jira", "atlassian", "issues", "agile", "tracking", "scrum"],
    message: "Jira Cloud REST API v3 — search, create, and inspect issues",
  },
  "swapi-graphql": {
    category: "entertainment",
    tags: ["star-wars", "graphql", "public", "no-auth", "demo", "movies"],
    message: "SWAPI GraphQL — films, people, planets, starships, vehicles and species",
  },
  "anilist-graphql": {
    category: "entertainment",
    tags: ["anime", "manga", "graphql", "public", "no-auth", "anilist"],
    message: "AniList GraphQL — search anime, manga, characters, and staff",
  },
  "linear-graphql": {
    category: "project-management",
    tags: ["linear", "graphql", "issues", "projects", "teams", "cycles", "agile"],
    message: "Linear GraphQL API — issues, teams, projects, and cycles",
  },
};

// ── Argument parsing ────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");
const ONLY_SLUG = args.find((a) => a.startsWith("--slug="))?.split("=")[1];

// ── Auth ────────────────────────────────────────────────────────────
const TOKEN = process.env.MCP_ONE_TOKEN;
if (!TOKEN && !DRY_RUN) {
  console.error("❌  MCP_ONE_TOKEN env var is required (or use --dry-run)");
  process.exit(1);
}

function headers(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

// ── Registry API helpers ────────────────────────────────────────────
const API = `${REGISTRY_URL}/api/v1`;

interface RegistryError { error: string; message: string }

async function apiPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }
  return { ok: res.ok, status: res.status, data };
}

// ── Loader ──────────────────────────────────────────────────────────
function loadConfigs(): Array<{ slug: string; payload: unknown }> {
  const files = fs.readdirSync(CONFIGS_DIR)
    .filter((f) => f.startsWith("mcp.") && f.endsWith(".json") && !f.endsWith(".example"));

  const configs: Array<{ slug: string; payload: unknown }> = [];

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CONFIGS_DIR, file), "utf-8")) as Record<string, unknown>;
    const slug = (raw.id as string | undefined)?.replace(/-mcp$/, "");
    if (!slug) continue;
    if (SKIP_SLUGS.has(slug)) continue;
    if (ONLY_SLUG && slug !== ONLY_SLUG) continue;
    if (!META[slug]) {
      console.warn(`⚠️  No metadata defined for "${slug}" — skipping`);
      continue;
    }
    configs.push({ slug, payload: raw });
  }

  return configs;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌱  mcp.one registry seeder`);
  console.log(`   registry  : ${REGISTRY_URL}`);
  console.log(`   namespace : ${NAMESPACE}`);
  console.log(`   version   : ${VERSION}`);
  console.log(`   dry-run   : ${DRY_RUN}`);
  console.log(`   force     : ${FORCE}`);
  if (ONLY_SLUG) console.log(`   slug filter: ${ONLY_SLUG}`);
  console.log();

  const configs = loadConfigs();
  console.log(`   ${configs.length} config(s) to process\n`);

  let published = 0;
  let versioned = 0;
  let skipped = 0;
  let failed = 0;

  for (const { slug, payload } of configs) {
    const meta = META[slug]!;
    const rawPayload = payload as Record<string, unknown>;
    const name = (rawPayload.name as string | undefined) ?? slug;
    const description = (rawPayload.description as string | undefined) ?? "";
    const connector_type = (rawPayload.connector as Record<string, unknown> | undefined)?.type as string ?? "http";

    console.log(`  📦  ${NAMESPACE}/${slug}  (${connector_type})`);

    if (DRY_RUN) {
      console.log(`       → [dry-run] would publish "${name}"`);
      console.log(`          category: ${meta.category}`);
      console.log(`          tags    : ${meta.tags.join(", ")}`);
      published++;
      continue;
    }

    // Try to create new first
    const createRes = await apiPost("/configs/", {
      namespace: NAMESPACE,
      slug,
      name,
      description,
      category: meta.category,
      connector_type,
      visibility: "public",
      tags: meta.tags,
      payload,
      message: meta.message ?? `Seed: ${name}`,
    });

    if (createRes.ok) {
      console.log(`       ✅  Published as new config (v${VERSION})`);
      published++;
      continue;
    }

    // 409 = already exists, try publishing a new version
    if (createRes.status === 409 && FORCE) {
      const versionRes = await apiPost(`/configs/${NAMESPACE}/${slug}/versions`, {
        version: VERSION,
        payload,
        message: meta.message ?? `Seed update: ${name}`,
      });

      if (versionRes.ok) {
        console.log(`       ✅  Published new version (${VERSION})`);
        versioned++;
      } else {
        const err = versionRes.data as RegistryError;
        console.log(`       ❌  Version publish failed (${versionRes.status}): ${err?.message ?? "unknown"}`);
        failed++;
      }
      continue;
    }

    if (createRes.status === 409) {
      console.log(`       ⏭️   Already exists — use --force to publish a new version`);
      skipped++;
      continue;
    }

    const err = createRes.data as RegistryError;
    console.log(`       ❌  Failed (${createRes.status}): ${err?.message ?? JSON.stringify(createRes.data)}`);
    failed++;
  }

  console.log(`\n   ─────────────────────────────`);
  console.log(`   published : ${published}`);
  if (versioned) console.log(`   versioned : ${versioned}`);
  if (skipped)   console.log(`   skipped   : ${skipped} (already exist)`);
  if (failed)    console.log(`   failed    : ${failed}`);
  console.log();

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
