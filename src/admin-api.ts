import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { validateConfig } from "./loader.js";
import { loadConfigEnv } from "./lib/env-store.js";
import { writeConfigEnv } from "./lib/env-writer.js";
import { log } from "./lib/logger.js";
import { CONNECTOR_TYPES, isConnectorType } from "./lib/connector-types.js";
import {
  RESERVED_IDS,
  validateBaseId,
  compoundId,
  toConfigSummary,
} from "./lib/config-rules.js";
import { loadManifest, removeFromManifest } from "./registry/auth.js";
import type { RegisteredTool, ParamDef } from "./types.js";
import { VERSION } from "./lib/version.js";
import { recentlySelfWrote } from "./connectors/mcp.js";
import type { LifecycleCtx, ConfigRuntime } from "./lifecycle/pipeline.js";

function buildInputSchema(params: ParamDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    const prop: Record<string, unknown> = { type: p.type, description: p.description };
    if (p.default !== undefined) prop.default = p.default;
    properties[p.name] = prop;
    if (p.required) required.push(p.name);
  }
  return { type: "object", properties, ...(required.length > 0 ? { required } : {}) };
}

export interface AdminContext {
  configDir: string;
  registry: {
    list(): RegisteredTool[];
    unregisterConfig(configId: string): void;
  };
  watcher: { pause(): void; resume(): void; isPaused(): boolean } | null;
  onManifestStyleChanged?: () => void;
  notifyToolsChanged?: () => Promise<void>;
  // pipeline integration (optional — absent when heku runs without HTTP/bridge)
  getRuntime?: (configId: string) => ConfigRuntime | undefined;
  bringServerOnline?: (ctx: LifecycleCtx) => void;
  takeServerOffline?: (configId: string, reason: "user-stop" | "config-deleted") => void;
}

// ── In-memory server settings ─────────────────────────────────────
// These reset to defaults on process restart, which is intentional.
// The --debug CLI flag is the durable way to boot with debug logging.

type LogLevel = "debug" | "info" | "warn" | "error";
export type ManifestStyle = "flat" | "namespaced";

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];
const VALID_MANIFEST_STYLES: ManifestStyle[] = ["flat", "namespaced"];

const serverSettings: {
  hotReload: boolean;
  logLevel: LogLevel;
  manifestStyle: ManifestStyle;
  configWriteLock: boolean;
  blockAutoInstall: boolean;
  blockAutoStart: boolean;
} = {
  hotReload: true,
  logLevel: "info",
  manifestStyle: "flat",
  configWriteLock: false,
  blockAutoInstall: false,
  blockAutoStart: false,
};

export function getServerSettings() {
  return { ...serverSettings };
}

const DISCOVERY_FLAT_SET = new Set(["heku.search", "heku.list_tools", "heku.list_configs", "heku.invoke"]);
const DISCOVERY_TRIO_SET = new Set(["heku.search", "heku.list_tools", "heku.list_configs"]);

export function createAdminRouter(ctx: AdminContext): Router {
  const router = Router();

  // ── GET /admin/tools-manifest?style=flat|namespaced ───────────────
  // Returns the tools/list handshake in the requested manifest style.

  router.get("/tools-manifest", (req, res) => {
    const styleParam = (req.query as { style?: string }).style;
    const style: ManifestStyle =
      styleParam === "namespaced" || styleParam === "flat"
        ? styleParam
        : serverSettings.manifestStyle;

    const tools = ctx.registry.list();

    if (style === "namespaced") {
      const visible = tools.filter((rt) =>
        DISCOVERY_TRIO_SET.has(`${rt.configId}.${rt.tool.name}`),
      );
      res.json(
        visible.map((rt) => ({
          name: `${rt.configId}.${rt.tool.name}`,
          description: rt.tool.description,
          inputSchema: buildInputSchema(rt.tool.params ?? []),
          configId: rt.configId,
        })),
      );
      return;
    }

    // flat
    const visible = tools.filter((rt) =>
      DISCOVERY_FLAT_SET.has(`${rt.configId}.${rt.tool.name}`),
    );
    res.json(
      visible.map((rt) => ({
        name: rt.tool.name,
        description: rt.tool.description,
        inputSchema: buildInputSchema(rt.tool.params ?? []),
        configId: rt.configId,
      })),
    );
  });

  // ── GET /admin/server-settings ───────────────────────────────────
  // Returns current runtime server settings (hot reload + log level).

  router.get("/server-settings", (_req, res) => {
    res.json({
      hotReload: ctx.watcher ? !ctx.watcher.isPaused() : serverSettings.hotReload,
      logLevel: serverSettings.logLevel,
      manifestStyle: serverSettings.manifestStyle,
      configWriteLock: serverSettings.configWriteLock,
      blockAutoInstall: serverSettings.blockAutoInstall,
      blockAutoStart: serverSettings.blockAutoStart,
      configDir: ctx.configDir,
      mcpServerVersion: VERSION,
    });
  });

  // ── POST /admin/server-settings ──────────────────────────────────
  // Accepts { hotReload?: boolean, logLevel?: string } and applies them live.

  router.post("/server-settings", (req, res) => {
    const body = req.body as {
      hotReload?: unknown;
      logLevel?: unknown;
      manifestStyle?: unknown;
      configWriteLock?: unknown;
      blockAutoInstall?: unknown;
      blockAutoStart?: unknown;
    };
    const errors: string[] = [];
    let manifestStyleChanged = false;

    if (body.hotReload !== undefined) {
      if (typeof body.hotReload !== "boolean") {
        errors.push('"hotReload" must be a boolean');
      } else {
        serverSettings.hotReload = body.hotReload;
        if (ctx.watcher) {
          if (body.hotReload) {
            ctx.watcher.resume();
          } else {
            ctx.watcher.pause();
          }
        }
        log.info("settings", `hotReload → ${body.hotReload}`);
      }
    }

    if (body.logLevel !== undefined) {
      if (!VALID_LOG_LEVELS.includes(body.logLevel as LogLevel)) {
        errors.push(`"logLevel" must be one of: ${VALID_LOG_LEVELS.join(", ")}`);
      } else {
        serverSettings.logLevel = body.logLevel as LogLevel;
        log.setConsoleLevel(body.logLevel as LogLevel);
        log.info("settings", `logLevel → ${body.logLevel}`);
      }
    }

    if (body.manifestStyle !== undefined) {
      if (!VALID_MANIFEST_STYLES.includes(body.manifestStyle as ManifestStyle)) {
        errors.push(`"manifestStyle" must be one of: ${VALID_MANIFEST_STYLES.join(", ")}`);
      } else {
        const prev = serverSettings.manifestStyle;
        serverSettings.manifestStyle = body.manifestStyle as ManifestStyle;
        if (prev !== serverSettings.manifestStyle) manifestStyleChanged = true;
        log.info("settings", `manifestStyle → ${body.manifestStyle}`);
      }
    }

    if (body.configWriteLock !== undefined) {
      if (typeof body.configWriteLock !== "boolean") {
        errors.push('"configWriteLock" must be a boolean');
      } else {
        serverSettings.configWriteLock = body.configWriteLock;
        log.info("settings", `configWriteLock → ${body.configWriteLock}`);
      }
    }

    if (body.blockAutoInstall !== undefined) {
      if (typeof body.blockAutoInstall !== "boolean") {
        errors.push('"blockAutoInstall" must be a boolean');
      } else {
        serverSettings.blockAutoInstall = body.blockAutoInstall;
        log.info("settings", `blockAutoInstall → ${body.blockAutoInstall}`);
      }
    }

    if (body.blockAutoStart !== undefined) {
      if (typeof body.blockAutoStart !== "boolean") {
        errors.push('"blockAutoStart" must be a boolean');
      } else {
        serverSettings.blockAutoStart = body.blockAutoStart;
        log.info("settings", `blockAutoStart → ${body.blockAutoStart}`);
      }
    }

    if (errors.length > 0) {
      res.status(400).json({ error: errors.join("; ") });
      return;
    }

    if (manifestStyleChanged) {
      ctx.onManifestStyleChanged?.();
    }

    res.json({
      ok: true,
      settings: {
        hotReload: ctx.watcher ? !ctx.watcher.isPaused() : serverSettings.hotReload,
        logLevel: serverSettings.logLevel,
        manifestStyle: serverSettings.manifestStyle,
        configWriteLock: serverSettings.configWriteLock,
        blockAutoInstall: serverSettings.blockAutoInstall,
        blockAutoStart: serverSettings.blockAutoStart,
      },
    });
  });

  // GET /admin/tools — all registered tools across all configs (unfiltered)
  router.get("/tools", (_req, res) => {
    const tools = ctx.registry.list().map((rt: RegisteredTool) => ({
      name: `${rt.configId}.${rt.tool.name}`,
      description: rt.tool.description,
      inputSchema: buildInputSchema(rt.tool.params),
      configId: rt.configId,
    }));
    res.json(tools);
  });

  // GET /admin/configs — flat array of ConfigSummary (raw JSON + live tool counts + auth status)
  router.get("/configs", (_req, res) => {
    const { configDir, registry } = ctx;

    const toolsByConfig = new Map<string, number>();
    for (const rt of registry.list()) {
      toolsByConfig.set(rt.configId, (toolsByConfig.get(rt.configId) ?? 0) + 1);
    }

    if (!fs.existsSync(configDir)) {
      res.json([]);
      return;
    }

    const configs = fs
      .readdirSync(configDir)
      .filter((f) => f.startsWith("mcp.") && f.endsWith(".json"))
      .flatMap((f) => {
        try {
          const raw = JSON.parse(
            fs.readFileSync(path.join(configDir, f), "utf-8"),
          ) as Record<string, unknown>;
          const id = String(raw["id"] ?? "");
          const summary = toConfigSummary(raw, toolsByConfig.get(id) ?? 0);
          const rt = ctx.getRuntime?.(id);
          if (rt) {
            summary.lifecycle = rt.state;
            if (rt.lastError) summary.lastError = rt.lastError;
            if (rt.installLogTail) summary.installLogTail = rt.installLogTail;
          }
          return [summary];
        } catch {
          return [];
        }
      });

    res.json(configs);
  });

  // GET /admin/configs/:id — full ConfigSummary for a single config
  router.get("/configs/:id", (req, res) => {
    const id = req.params["id"]!;
    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
      const toolCount = ctx.registry.list().filter((rt) => rt.configId === id).length;
      const summary = toConfigSummary(raw, toolCount);
      const rt = ctx.getRuntime?.(id);
      if (rt) {
        summary.lifecycle = rt.state;
        if (rt.lastError) summary.lastError = rt.lastError;
        if (rt.installLogTail) summary.installLogTail = rt.installLogTail;
      }
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /admin/configs — create (body sends base id; server compounds it with connector.type)
  router.post("/configs", (req, res) => {
    const body = req.body as Record<string, unknown>;

    const idError = validateBaseId(body["id"]);
    if (idError) {
      res.status(400).json({ error: idError });
      return;
    }
    const baseId = body["id"] as string;

    const connector = body["connector"] as Record<string, unknown> | undefined;
    const connectorType = connector?.["type"] as string | undefined;
    if (!connectorType || !isConnectorType(connectorType)) {
      res.status(400).json({ error: `connector.type must be one of: ${CONNECTOR_TYPES.join(", ")}` });
      return;
    }

    const cId = compoundId(baseId, connectorType);
    const filePath = path.join(ctx.configDir, `mcp.${cId}.json`);

    if (fs.existsSync(filePath) && !body["force"]) {
      res.status(409).json({
        error: `Config "${baseId}" (${connectorType}) already exists as mcp.${cId}.json. Pass force: true to overwrite.`,
      });
      return;
    }

    const rawConfig: Record<string, unknown> = {
      id: cId,
      name: body["name"] ?? baseId,
      connector: body["connector"] ?? {},
      tools: body["tools"] ?? [],
    };
    if (body["description"]) rawConfig["description"] = body["description"];
    if (body["overlays"]) rawConfig["overlays"] = body["overlays"];

    try {
      validateConfig(rawConfig, `mcp.${cId}.json`);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    fs.mkdirSync(ctx.configDir, { recursive: true });
    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(rawConfig, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, filePath);

    res.status(201).json({ ok: true, id: cId });
  });

  // PUT /admin/configs/:id — replace entire config (full validation, supports tool edits)
  router.put("/configs/:id", (req, res) => {
    const id = req.params["id"]!;

    if (RESERVED_IDS.includes(id)) {
      res.status(403).json({ error: `Config "${id}" is protected and cannot be replaced` });
      return;
    }

    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    const body = req.body as Record<string, unknown>;
    const bodyId = typeof body["id"] === "string" ? body["id"] : id;
    if (bodyId !== id) {
      res.status(400).json({ error: `Body id "${bodyId}" does not match URL id "${id}"` });
      return;
    }

    const raw = { ...body, id };

    try {
      validateConfig(raw, `mcp.${id}.json`);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }

    const tmpPath = filePath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
    fs.renameSync(tmpPath, filePath);
    res.json({ ok: true });
  });

  // POST /admin/credentials — write env vars to a config's .env file and reload.
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
      const result = writeConfigEnv(ctx.configDir, configId, entries, overwrite);
      res.json({ ok: true, written: result.written, skipped: result.skipped });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /admin/reload-env — reload a config's secrets file into the env store.
  // Called by the Express bridge after credentials are written to disk.
  router.post("/reload-env", (req, res) => {
    const { configId } = req.body as { configId?: string };
    if (!configId || typeof configId !== "string") {
      res.status(400).json({ error: "configId is required" });
      return;
    }
    const filePath = path.join(ctx.configDir, `mcp.${configId}.env`);
    const count = loadConfigEnv(configId, filePath);
    res.json({ ok: true, configId, updated: count });
  });

  // DELETE /admin/configs/:id — delete config file
  router.delete("/configs/:id", (req, res) => {
    const id = req.params["id"]!;

    if (RESERVED_IDS.includes(id)) {
      res.status(403).json({ error: `Config "${id}" is protected and cannot be deleted` });
      return;
    }

    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    fs.unlinkSync(filePath);

    // Also remove from the registry manifest so the registry page no longer
    // shows this config as installed after it's been deleted from the config page.
    const manifest = loadManifest();
    const entry = manifest.installed.find((e) => {
      const withoutNs = e.slug.replace(/^@[^/]+\//, "");
      const colonIdx  = withoutNs.indexOf(":");
      if (colonIdx === -1) return false;
      const base = withoutNs.slice(0, colonIdx);
      const ct   = withoutNs.slice(colonIdx + 1);
      return `${base}-${ct}` === id;
    });
    if (entry) removeFromManifest(entry.slug, entry.registry);

    res.json({ ok: true });
  });

  // PATCH /admin/configs/:id — partial update ({ active: boolean } for all connector types)
  router.patch("/configs/:id", (req, res) => {
    const id = req.params["id"]!;
    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }

    const body = req.body as Record<string, unknown>;
    if (body["active"] === undefined) {
      res.status(400).json({ error: "only { active: boolean } is supported in PATCH" });
      return;
    }
    if (typeof body["active"] !== "boolean") {
      res.status(400).json({ error: '"active" must be a boolean' });
      return;
    }
    const newActive = body["active"] as boolean;

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }

    const connector = raw["connector"] as Record<string, unknown> | undefined;
    if (!connector) {
      res.status(400).json({ error: "config has no connector" });
      return;
    }
    const connectorType = connector["type"] as string;

    connector["active"] = newActive;
    raw["connector"] = connector;

    // Deactivations and MCP activations are handled directly below — suppress the watcher.
    // For non-MCP activations we let the watcher fire so connector-specific reinit
    // (GraphQL introspection, gRPC reflection, SQL pool, etc.) runs through the normal path.
    const suppressWatcher = !newActive || connectorType === "mcp";
    if (suppressWatcher) recentlySelfWrote.add(id);

    try {
      const tmpPath = filePath + ".tmp";
      fs.writeFileSync(tmpPath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
      fs.renameSync(tmpPath, filePath);
    } catch (err) {
      if (suppressWatcher) recentlySelfWrote.delete(id);
      res.status(500).json({ error: (err as Error).message });
      return;
    }

    if (!newActive) {
      // Deactivate: strip tools from the registry immediately for all connector types
      ctx.registry.unregisterConfig(id);
      void ctx.notifyToolsChanged?.();
      // MCP: also stop the subprocess
      if (connectorType === "mcp" && ctx.takeServerOffline) {
        ctx.takeServerOffline(id, "user-stop");
      }
    } else if (connectorType === "mcp") {
      // MCP activate: pipeline brings subprocess online (handles registry + notify)
      if (ctx.bringServerOnline) {
        const mcpConfig = connector as unknown as import("./types.js").McpConnectorConfig;
        ctx.bringServerOnline({ configId: id, trigger: "user-start", config: mcpConfig, filePath });
      }
    }
    // Non-MCP activate: watcher re-fires and handles re-registration + notify

    res.json({ ok: true, id, active: newActive });
  });

  // POST /admin/configs/:id/start — manually start a config (ignores block flags)
  router.post("/configs/:id/start", (req, res) => {
    const id = req.params["id"]!;
    const filePath = path.join(ctx.configDir, `mcp.${id}.json`);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Config "${id}" not found` });
      return;
    }
    if (!ctx.bringServerOnline) {
      res.status(503).json({ error: "pipeline not available" });
      return;
    }

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
      return;
    }

    const connector = raw["connector"] as Record<string, unknown> | undefined;
    if (!connector || connector["type"] !== "mcp") {
      res.status(400).json({ error: "start is only available for mcp connector configs" });
      return;
    }

    const mcpConfig = connector as unknown as import("./types.js").McpConnectorConfig;
    ctx.bringServerOnline({ configId: id, trigger: "user-start", config: mcpConfig, filePath });
    res.json({ ok: true, id });
  });

  // POST /admin/configs/:id/stop — manually stop a running MCP server
  router.post("/configs/:id/stop", (req, res) => {
    const id = req.params["id"]!;

    if (!ctx.takeServerOffline) {
      res.status(503).json({ error: "pipeline not available" });
      return;
    }

    ctx.takeServerOffline(id, "user-stop");
    res.json({ ok: true, id });
  });

  // GET /admin/configs/:id/runtime — live runtime state for an MCP config
  router.get("/configs/:id/runtime", (req, res) => {
    const id = req.params["id"]!;
    if (!ctx.getRuntime) {
      res.status(503).json({ error: "pipeline not available" });
      return;
    }
    const runtime = ctx.getRuntime(id);
    if (!runtime) {
      res.json({ id, state: "idle", userStopped: false });
      return;
    }
    res.json(runtime);
  });

  return router;
}
