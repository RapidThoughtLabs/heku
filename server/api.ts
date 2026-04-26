import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import type { McpClientInstance } from "./mcp-client.js";
import {
  listConfigs,
  getConfig,
  createConfig,
  updateConfig,
  deleteConfig,
} from "./config-io.js";
import { loadManifest, loadRegistries } from "../src/registry/auth.js";

// ── Credential writer ─────────────────────────────────────────────
// Writes env vars to .env (same logic as src/lib/env-writer appendEnvVars)
// and immediately loads them into process.env so mcp-one picks them up.

const ENV_PATH = path.join(process.cwd(), ".env");

function writeCredentials(
  serviceId: string,
  entries: { key: string; value: string }[],
  overwrite = false,
): string[] {
  const valid = entries.filter((e) => e.value.trim().length > 0);
  if (valid.length === 0) return [];

  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf-8") : "";
  const lines = existing ? existing.split(/\r?\n/) : [];

  // Strip trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  const written: string[] = [];
  const toAppend: { key: string; value: string }[] = [];

  for (const { key, value } of valid) {
    const idx = lines.findIndex((l) => {
      const t = l.trim();
      if (t.startsWith("#") || !t.includes("=")) return false;
      return t.slice(0, t.indexOf("=")).trim() === key;
    });

    if (idx !== -1 && overwrite) {
      lines[idx] = `${key}=${value}`;
      written.push(key);
    } else if (idx === -1) {
      toAppend.push({ key, value });
    }
    // idx !== -1 && !overwrite → skip (already set)
  }

  let result = lines.join("\n");
  if (toAppend.length > 0) {
    if (result.length > 0) result += "\n\n";
    result += `# ${serviceId} (added via mcp-one UI)\n`;
    for (const { key, value } of toAppend) {
      result += `${key}=${value}\n`;
      written.push(key);
    }
  } else if (written.length > 0) {
    result += "\n";
  }

  if (written.length > 0) {
    fs.writeFileSync(ENV_PATH, result, "utf-8");
  }

  // Always mirror submitted values into process.env, even when the file
  // write was skipped (key already present, overwrite=false). Without
  // this, a save can be a no-op on disk AND leave process.env empty,
  // causing the auth card to stay red forever.
  for (const { key, value } of valid) {
    process.env[key] = value;
  }

  return written;
}

// ─────────────────────────────────────────────────────────────────

export function createApiRouter(mcp: McpClientInstance): Router {
  const router = Router();

  // ── GET /api/health ──────────────────────────────────────────────
  // Returns server status and MCP connection state

  router.get("/health", (_req, res) => {
    const { status, toolCount, endpoint } = mcp.getStatus();
    res.json({
      status: "ok",
      mcpStatus: status,
      mcpConnected: status === "connected",
      toolCount,
      endpoint,
      ts: Date.now(),
    });
  });

  // ── POST /api/connect ─────────────────────────────────────────────
  // Connect to a specific mcp-one HTTP endpoint

  router.post("/connect", async (req, res) => {
    const { endpoint } = req.body as { endpoint?: string };
    if (!endpoint || typeof endpoint !== "string") {
      res.status(400).json({ error: '"endpoint" (string) is required' });
      return;
    }
    try {
      await mcp.connectToEndpoint(endpoint);
      mcp.addLog("info", "api", `Connected to endpoint: ${endpoint}`);
      res.json({ ok: true, endpoint });
    } catch (err) {
      res.status(502).json({ error: `Failed to connect: ${(err as Error).message}` });
    }
  });

  // ── POST /api/disconnect ──────────────────────────────────────────
  // Disconnect from current mcp-one instance

  router.post("/disconnect", async (_req, res) => {
    await mcp.disconnect();
    res.json({ ok: true });
  });

  // ── GET /api/configs ─────────────────────────────────────────────
  // List all mcp.*.json configs with auth status.
  // For auto-discovery connectors (graphql, grpc, mcp) the JSON file has
  // tools:[] — enrich toolCount with the live runtime count from mcp-one.

  router.get("/configs", (_req, res) => {
    try {
      const configs = listConfigs();
      // Build a per-configId runtime tool count from the live tool list
      const runtimeCounts = new Map<string, number>();
      for (const tool of mcp.listTools()) {
        runtimeCounts.set(tool.configId, (runtimeCounts.get(tool.configId) ?? 0) + 1);
      }
      const enriched = configs.map((cfg) => {
        const runtime = runtimeCounts.get(cfg.id);
        if (runtime !== undefined && cfg.toolCount === 0) {
          return { ...cfg, toolCount: runtime };
        }
        return cfg;
      });
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/configs/:id/detail ──────────────────────────────────
  // Full detail: config + runtime tools + registry origin

  router.get("/configs/:id/detail", (req, res) => {
    try {
      const id = req.params["id"]!;
      const config = getConfig(id);
      if (!config) {
        res.status(404).json({ error: `Config "${id}" not found` });
        return;
      }
      const tools = mcp.listTools().filter((t) => t.configId === id);
      const manifest = loadManifest();
      const registries = loadRegistries();
      // Match manifest entries by deriving compound id from the qualified slug (@ns/slug:ct → slug-ct)
      const entry = manifest.installed.find((e) => {
        const withoutNs = e.slug.replace(/^@[^/]+\//, "");
        const colonIdx  = withoutNs.indexOf(":");
        if (colonIdx === -1) return false;
        const base = withoutNs.slice(0, colonIdx);
        const ct   = withoutNs.slice(colonIdx + 1);
        return `${base}-${ct}` === id;
      }) ?? null;
      let registryUrl: string | null = null;
      if (entry) {
        const reg = registries.find((r) => r.name === entry.registry);
        registryUrl = reg?.url ?? null;
      }
      res.json({ config, tools, registry: entry ? { ...entry, registryUrl } : null });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/configs/:id ─────────────────────────────────────────
  // Single config by id

  router.get("/configs/:id", (req, res) => {
    try {
      const config = getConfig(req.params["id"]!);
      if (!config) {
        res.status(404).json({ error: `Config "${req.params["id"]}" not found` });
        return;
      }
      res.json(config);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── POST /api/configs ────────────────────────────────────────────
  // Create a new config → writes mcp.{id}.json

  router.post("/configs", (req, res) => {
    try {
      const result = createConfig(req.body as unknown);
      if (!result.ok) {
        res.status(400).json({ error: "Validation failed", errors: result.errors });
        return;
      }
      mcp.addLog("info", "config", `Config created: ${(req.body as Record<string, unknown>)["id"] ?? "?"}`);
      res.status(201).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── PUT /api/configs/:id ─────────────────────────────────────────
  // Update an existing config

  router.put("/configs/:id", (req, res) => {
    try {
      const id = req.params["id"]!;
      const result = updateConfig(id, req.body as unknown);
      if (!result.ok) {
        res.status(400).json({ error: "Validation failed", errors: result.errors });
        return;
      }
      mcp.addLog("info", "config", `Config updated: ${id}`);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── DELETE /api/configs/:id ──────────────────────────────────────
  // Delete a config file

  router.delete("/configs/:id", async (req, res) => {
    try {
      const id = req.params["id"]!;
      const result = deleteConfig(id);
      if (!result.ok) {
        const code = result.errors?.[0]?.message.includes("not found") ? 404 : 400;
        res.status(code).json({ error: "Delete failed", errors: result.errors });
        return;
      }
      mcp.addLog("info", "config", `Config deleted: ${id}`);
      // Force-refresh tool list so deleted config's tools don't linger in cache
      await mcp.refreshTools();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ── GET /api/tools ───────────────────────────────────────────────
  // List all registered tools from mcp-one

  router.get("/tools", (_req, res) => {
    res.json(mcp.listTools());
  });

  // ── POST /api/tools/call ─────────────────────────────────────────
  // Execute a tool: { name: string, arguments: object }

  router.post("/tools/call", async (req, res) => {
    const body = req.body as Record<string, unknown>;
    const name = body["name"];
    const args = (body["arguments"] ?? {}) as Record<string, unknown>;

    // Build a caller label from optional agent headers forwarded by the UI.
    // The mcp-one server will also see X-Source: dashboard from the bridge transport.
    const callerParts = ["dashboard"];
    const agentId = req.headers["x-agent-id"] as string | undefined;
    const chatId  = req.headers["x-chat-id"]  as string | undefined;
    if (agentId) callerParts.push(`agent:${agentId}`);
    if (chatId)  callerParts.push(`chat:${chatId}`);
    const callerInfo = callerParts.join(" | ");

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: '"name" (string) is required' });
      return;
    }

    try {
      const result = await mcp.callTool(name, args);
      mcp.addLog("info", "api", `tools/call ${name} [${callerInfo}] → OK`);
      res.json({ ok: true, result });
    } catch (err) {
      const message = (err as Error).message;
      mcp.addLog("error", "api", `tools/call ${name} [${callerInfo}] → ERROR: ${message}`);
      const status = message === "MCP server not connected" ? 503 : 500;
      res.status(status).json({ error: message });
    }
  });

  // ── GET /api/logs ────────────────────────────────────────────────
  // In-memory activity log (last 500 entries)

  router.get("/logs", (_req, res) => {
    const limit = 500;
    const logs = mcp.getLogs().slice(-limit);
    res.json(logs);
  });

  // ── POST /api/credentials ────────────────────────────────────────
  // Write credential env vars to .env for a given config.
  // Body: { configId: string, entries: { key: string, value: string }[], overwrite?: boolean }

  router.post("/credentials", (req, res) => {
    const { configId, entries, overwrite = false } = req.body as {
      configId?: string;
      entries?: { key: string; value: string }[];
      overwrite?: boolean;
    };

    if (!configId || typeof configId !== "string") {
      res.status(400).json({ error: '"configId" (string) is required' });
      return;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      res.status(400).json({ error: '"entries" must be a non-empty array of {key, value}' });
      return;
    }

    try {
      const written = writeCredentials(configId, entries, overwrite);
      mcp.addLog("info", "api", `Credentials saved for: ${configId} (${written.join(", ")})`);
      res.json({ ok: true, written });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
