/**
 * Server management handlers for the internal connector.
 */

import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";
import { VERSION } from "../../lib/version.js";

const START_TIME = Date.now();

export async function handleServerStatus(
  ctx: InternalContext,
  _args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const tools   = ctx.registry.list();
  const toolsByConfig = new Map<string, number>();
  for (const rt of tools) {
    toolsByConfig.set(rt.configId, (toolsByConfig.get(rt.configId) ?? 0) + 1);
  }

  const configs = Array.from(toolsByConfig.entries()).map(([id, count]) => ({
    id,
    tool_count: count,
  }));

  const uptimeMs = Date.now() - START_TIME;

  return {
    success: true,
    data: {
      service:    "heku",
      version:    VERSION,
      uptime_ms:  uptimeMs,
      uptime:     formatUptime(uptimeMs),
      tool_count: tools.length,
      config_count: toolsByConfig.size,
      configs,
      config_dir: ctx.configDir,
    },
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0)   return `${h}h ${m % 60}m`;
  if (m > 0)   return `${m}m ${s % 60}s`;
  return `${s}s`;
}
