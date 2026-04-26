/**
 * Registry proxy router.
 *
 * All registry logic (credentials, manifest, HTTP calls, ETag verification)
 * lives in src/registry/ — this file is a thin Express adapter only.
 *
 * No duplication. The same modules power the mcp-one CLI commands.
 */

import fs from "node:fs";
import path from "node:path";
import { Router } from "express";

// ── Import from the single source of truth ────────────────────────
// tsx (dev) resolves .js → .ts automatically.
// These are the exact same modules used by `mcp-one search`, `mcp-one install`, etc.

import {
  loadManifest,
  addToManifest,
  removeFromManifest,
  loadRegistries,
  isLoggedIn,
  loadCredentials,
  getRegistry,
} from "../src/registry/auth.js";

import {
  searchConfigs,
  featuredConfigs,
  popularConfigs,
  recentConfigs,
  fetchVersionPayload,
  getConfigMeta,
  checkUpdates,
  whoami,
  RegistryError,
} from "../src/registry/client.js";

// ── Install helper ────────────────────────────────────────────────

function getMcpConfigsDir(): string {
  return path.join(process.cwd(), "mcp-configs");
}

// ── Router ────────────────────────────────────────────────────────

export function createRegistryRouter(): Router {
  const router = Router();

  // Centralised async error handler
  function wrap(fn: (req: import("express").Request, res: import("express").Response) => Promise<void>) {
    return (req: import("express").Request, res: import("express").Response) => {
      fn(req, res).catch((err: unknown) => {
        const status = err instanceof RegistryError ? err.status : (err as { status?: number }).status ?? 500;
        const message = err instanceof Error ? err.message : "Internal error";
        res.status(status).json({ error: message });
      });
    };
  }

  // ── GET /api/registry/sources ─────────────────────────────────────
  // Returns all configured registry sources from ~/.mcp-one/registries.json
  router.get("/sources", (_req, res) => {
    res.json(loadRegistries());
  });

  // ── GET /api/registry/auth/status ────────────────────────────────
  router.get("/auth/status", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    if (!isLoggedIn(registry)) {
      res.json({ loggedIn: false });
      return;
    }
    try {
      const user = await whoami(registry);
      res.json({ loggedIn: true, user });
    } catch {
      res.json({ loggedIn: false });
    }
  }));

  // ── GET /api/registry/search ──────────────────────────────────────
  router.get("/search", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const { q, tags, category, connector_type, verified, namespace, sort_by, limit, offset } = req.query as Record<string, string | undefined>;

    const data = await searchConfigs({
      q,
      tags,
      category,
      connector_type,
      verified: verified === "true" ? true : undefined,
      namespace,
      sort_by: sort_by as "popular" | "recent" | "name" | undefined,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    }, registry);
    res.json(data);
  }));

  // ── GET /api/registry/featured ────────────────────────────────────
  router.get("/featured", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await featuredConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/popular ─────────────────────────────────────
  router.get("/popular", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await popularConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/recent ──────────────────────────────────────
  router.get("/recent", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const limit = req.query["limit"] ? Number(req.query["limit"]) : 20;
    const data = await recentConfigs(limit, registry);
    res.json(data);
  }));

  // ── GET /api/registry/stats ───────────────────────────────────────
  router.get("/stats", wrap(async (req, res) => {
    const registry = (req.query["registry"] as string | undefined) ?? "default";
    const regInfo = getRegistry(registry);
    const res2 = await fetch(`${regInfo.url}/api/v1/stats`, {
      headers: loadCredentials(registry) ? { Authorization: `Bearer ${loadCredentials(registry)!.access_token}` } : {},
    });
    if (!res2.ok) {
      res.status(res2.status).json({ error: await res2.text() });
      return;
    }
    res.json(await res2.json());
  }));

  // ── GET /api/registry/manifest ────────────────────────────────────
  router.get("/manifest", (_req, res) => {
    res.json(loadManifest());
  });

  // ── POST /api/registry/check-updates ─────────────────────────────
  router.post("/check-updates", wrap(async (req, res) => {
    const { installed, registry = "default" } = req.body as {
      installed?: { slug: string; version: string }[];
      registry?: string;
    };
    if (!Array.isArray(installed)) {
      res.status(400).json({ error: '"installed" must be an array' });
      return;
    }
    const data = await checkUpdates(installed, registry);
    res.json(data);
  }));

  // ── POST /api/registry/install ────────────────────────────────────
  router.post("/install", wrap(async (req, res) => {
    const { namespace, slug, connector_type, version, registry = "default", overwrite = false } = req.body as {
      namespace: string;
      slug: string;
      connector_type?: string;
      version?: string;
      registry?: string;
      overwrite?: boolean;
    };

    if (!namespace || !slug) {
      res.status(400).json({ error: '"namespace" and "slug" are required' });
      return;
    }

    // Step 1: Fetch config metadata to resolve qualified slug and connector type (D5)
    let meta: Awaited<ReturnType<typeof getConfigMeta>>;
    try {
      meta = await getConfigMeta(namespace, slug, connector_type, registry);
    } catch (err) {
      if (err instanceof RegistryError) {
        if (err.status === 400 && err.code === "ambiguous_slug") {
          res.status(400).json({
            error: "ambiguous_slug",
            available_variants: err.body?.["available_variants"],
            examples: err.body?.["examples"],
          });
          return;
        }
        throw err;
      }
      throw err;
    }

    const qualifiedSlug     = meta.qualified_slug;
    const resolvedConnector = meta.connector_type;
    const installedId       = `${slug}-${resolvedConnector}`; // D2

    const configsDir = getMcpConfigsDir();
    const filePath   = path.join(configsDir, `mcp.${installedId}.json`); // D1

    if (fs.existsSync(filePath) && !overwrite) {
      res.status(409).json({ error: `"${installedId}" is already installed. Send overwrite:true to reinstall.` });
      return;
    }

    // Step 2: Download payload
    const { payload, version: resolvedVersion } = await fetchVersionPayload(
      namespace, slug, resolvedConnector, version, registry,
    );

    // D2: set compound id in the payload
    (payload as Record<string, unknown>).id = installedId;

    fs.mkdirSync(configsDir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

    // D3: store qualified slug in manifest
    addToManifest(qualifiedSlug, resolvedVersion, resolvedConnector, registry);

    res.status(201).json({ ok: true, configId: installedId, qualified_slug: qualifiedSlug, version: resolvedVersion });
  }));

  // ── DELETE /api/registry/uninstall/:id ───────────────────────────
  // :id is the compound config id, e.g. "github-http"
  router.delete("/uninstall/:id", wrap(async (req, res) => {
    const id       = req.params["id"]!;
    const registry = (req.query["registry"] as string | undefined) ?? "default";

    const filePath = path.join(getMcpConfigsDir(), `mcp.${id}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    // Find and remove the matching manifest entry by compound id (D3)
    const manifest = loadManifest();
    const entry    = manifest.installed.find((e) => {
      const withoutNs = e.slug.replace(/^@[^/]+\//, "");
      const colonIdx  = withoutNs.indexOf(":");
      if (colonIdx === -1) return false;
      return `${withoutNs.slice(0, colonIdx)}-${withoutNs.slice(colonIdx + 1)}` === id && e.registry === registry;
    });

    if (entry) removeFromManifest(entry.slug, registry);
    res.json({ ok: true });
  }));

  return router;
}
