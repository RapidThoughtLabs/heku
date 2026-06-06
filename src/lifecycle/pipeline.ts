import type { McpConnectorConfig } from "../types.js";
import type { LifecycleState } from "../lib/config-rules.js";
import type { McpConfig } from "../types.js";

export type { LifecycleState };

export type LifecycleTrigger = "watcher" | "startup" | "user-start" | "user-restart";

export interface LifecycleCtx {
  configId: string;
  trigger: LifecycleTrigger;
  config: McpConnectorConfig;
  filePath: string;
}

export interface ConfigRuntime {
  id: string;
  state: LifecycleState;
  lastError?: string;
  installLogTail?: string[];
  userStopped: boolean;
  parkReason?: string;
}

interface McpConnectorInterface {
  runInstallForConfig(configId: string, config: McpConnectorConfig): Promise<{ logTail: string[] }>;
  connectConfig(configId: string, config: McpConnectorConfig, filePath?: string): Promise<void>;
  disconnectConfig(configId: string): Promise<void>;
}

interface RegistryInterface {
  registerConfig(config: McpConfig): void;
  unregisterConfig(configId: string): void;
}

interface PipelineDeps {
  mcpConnector: McpConnectorInterface;
  registry: RegistryInterface;
  notifyToolsChanged(): Promise<void>;
  loadSingleConfig(filePath: string): McpConfig | null;
  getSettings(): { blockAutoInstall: boolean; blockAutoStart: boolean };
}

// ── Module-level state ─────────────────────────────────────────────

const runtimeMap = new Map<string, ConfigRuntime>();
const queues = new Map<string, Promise<void>>();
let deps: PipelineDeps | null = null;

// ── Init ───────────────────────────────────────────────────────────

export function initPipeline(d: PipelineDeps): void {
  deps = d;
}

// ── State helpers ──────────────────────────────────────────────────

export function setRuntimeState(id: string, partial: Partial<ConfigRuntime>): void {
  const existing = runtimeMap.get(id) ?? { id, state: "idle" as LifecycleState, userStopped: false };
  runtimeMap.set(id, { ...existing, ...partial });
}

export function getRuntime(id: string): ConfigRuntime | undefined {
  return runtimeMap.get(id);
}

export function getAllRuntimes(): ConfigRuntime[] {
  return Array.from(runtimeMap.values());
}

export function deleteRuntime(id: string): void {
  runtimeMap.delete(id);
  queues.delete(id);
}

// ── Queue helpers ──────────────────────────────────────────────────

function enqueue(configId: string, task: () => Promise<void>): void {
  const prev = queues.get(configId) ?? Promise.resolve();
  const next = prev
    .then(task)
    .catch((err: unknown) => {
      console.error(`[pipeline:${configId}] queue error:`, err);
    });
  queues.set(configId, next);
}

// ── Public API ─────────────────────────────────────────────────────

export function bringServerOnline(ctx: LifecycleCtx): void {
  enqueue(ctx.configId, () => _bringServerOnline(ctx));
}

export function takeServerOffline(
  configId: string,
  reason: "user-stop" | "config-deleted",
): void {
  enqueue(configId, () => _takeServerOffline(configId, reason));
}

// ── Internal ───────────────────────────────────────────────────────

async function _bringServerOnline(ctx: LifecycleCtx): Promise<void> {
  if (!deps) {
    console.error(`[pipeline:${ctx.configId}] pipeline not initialized — skipping`);
    return;
  }

  const { configId, trigger, config } = ctx;
  const settings = deps.getSettings();

  // Seed runtime entry if first time seeing this configId
  if (!runtimeMap.has(configId)) {
    setRuntimeState(configId, { id: configId, state: "idle", userStopped: false });
  }

  const rt = runtimeMap.get(configId)!;

  // Respect user-stopped: only user-start / user-restart can override
  if (rt.userStopped && trigger !== "user-start" && trigger !== "user-restart") {
    return;
  }

  if (trigger === "user-start" || trigger === "user-restart") {
    setRuntimeState(configId, { userStopped: false });
  }

  const isAutoTrigger = trigger === "watcher" || trigger === "startup";

  // blockAutoInstall gate: install_command present + auto trigger → park at idle
  if (settings.blockAutoInstall && config.install_command && isAutoTrigger) {
    setRuntimeState(configId, {
      state: "idle",
      lastError: "auto-install blocked",
      parkReason: "auto-install blocked",
    });
    console.error(`[pipeline:${configId}] install blocked (blockAutoInstall=true)`);
    return;
  }

  // ── Install step ───────────────────────────────────────────────
  if (config.install_command) {
    setRuntimeState(configId, { state: "installing", lastError: undefined, parkReason: undefined });
    try {
      const { logTail } = await deps.mcpConnector.runInstallForConfig(configId, config);
      setRuntimeState(configId, { state: "installed", installLogTail: logTail });
    } catch (err) {
      setRuntimeState(configId, { state: "error", lastError: (err as Error).message });
      return;
    }
  } else {
    setRuntimeState(configId, { state: "installed" });
  }

  // active=false gate: park at installed (user-start overrides by intention)
  if (config.active === false && trigger !== "user-start") {
    setRuntimeState(configId, { parkReason: "inactive" });
    console.error(`[pipeline:${configId}] parked at installed (active=false)`);
    return;
  }

  // blockAutoStart gate: install but don't spawn
  if (settings.blockAutoStart && isAutoTrigger) {
    setRuntimeState(configId, { parkReason: "auto-start blocked" });
    console.error(`[pipeline:${configId}] parked at installed (blockAutoStart=true)`);
    return;
  }

  // ── Connect step ───────────────────────────────────────────────
  setRuntimeState(configId, { state: "starting", lastError: undefined, parkReason: undefined });
  try {
    await deps.mcpConnector.connectConfig(configId, config, ctx.filePath);
    setRuntimeState(configId, { state: "running" });

    // Startup trigger: tools are injected in start.ts after initAll — skip registry here
    if (trigger !== "startup") {
      const freshConfig = deps.loadSingleConfig(ctx.filePath);
      if (freshConfig) {
        deps.registry.registerConfig(freshConfig);
        await deps.notifyToolsChanged();
      }
    }

    console.error(`[pipeline:${configId}] online`);
  } catch (err) {
    setRuntimeState(configId, { state: "error", lastError: (err as Error).message });
    console.error(`[pipeline:${configId}] start failed:`, (err as Error).message);
  }
}

async function _takeServerOffline(
  configId: string,
  reason: "user-stop" | "config-deleted",
): Promise<void> {
  if (!deps) return;

  try {
    await deps.mcpConnector.disconnectConfig(configId);
  } catch {
    // best-effort disconnect
  }

  deps.registry.unregisterConfig(configId);
  await deps.notifyToolsChanged();

  if (reason === "user-stop") {
    setRuntimeState(configId, { state: "stopped", userStopped: true });
  } else {
    // config-deleted: remove runtime entry entirely
    runtimeMap.delete(configId);
    queues.delete(configId);
  }
}
