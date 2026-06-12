/**
 * invoke handler — proxy-execute any registered tool by qualified name.
 *
 * This is the execution bridge for the discover → execute workflow:
 *   heku.search("weather") → finds open-meteo-http.get_forecast
 *   heku.invoke({ tool: "open-meteo-http.get_forecast", args: { ... } }) → live data
 *
 * The handler resolves the target tool from the registry and delegates to
 * execute(), which routes through the correct connector (http, cli, mcp, etc.).
 */

import { execute } from "../../executor.js";
import type { ConnectorResult } from "../base.js";
import type { InternalContext } from "../internal.js";

export async function handleInvoke(
  ctx: InternalContext,
  args: Record<string, unknown>,
): Promise<ConnectorResult> {
  const toolName = args.tool as string | undefined;
  if (!toolName || typeof toolName !== "string") {
    return { success: false, data: { error: "\"tool\" is required (format: config_id.tool_name)" } };
  }

  const toolArgs = (args.args ?? {}) as Record<string, unknown>;
  if (typeof toolArgs !== "object" || Array.isArray(toolArgs)) {
    return { success: false, data: { error: "\"args\" must be an object" } };
  }

  const registered = ctx.registry.get(toolName);
  if (!registered) {
    const available = ctx.registry.list().map((rt) => `${rt.configId}.${rt.tool.name}`);
    return {
      success: false,
      data: {
        error: `Tool "${toolName}" not found`,
        hint: "Use heku.search or heku.list_tools to find available tool names",
        available_count: available.length,
      },
    };
  }

  // Delegate to executor — same path as a direct tool/call from the client.
  // CallerContext is omitted (internal call, no transport/session metadata).
  return execute(registered, toolArgs);
}
