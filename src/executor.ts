import { getRateLimiter } from "./rate-limiter.js";
import { AuthNotConfiguredError } from "./auth/errors.js";
import { connectorRegistry } from "./connectors/registry.js";
import { validateArgs } from "./connectors/validation.js";
import { stripResponse } from "./lib/strip-response.js";
import { log } from "./lib/logger.js";
import type { RegisteredTool, CallerContext } from "./types.js";
import type { ConnectorResult } from "./connectors/base.js";

export async function execute(
  tool: RegisteredTool,
  args: Record<string, unknown>,
  caller?: CallerContext,
): Promise<ConnectorResult> {
  getRateLimiter().check(tool.configId);

  const toolName = `${tool.configId}.${tool.tool.name}`;
  const start = Date.now();

  log.toolCallStart({
    tool: toolName,
    configId: tool.configId,
    requestId: caller?.requestId,
    caller: formatCaller(caller),
    callerCtx: caller,
    args,
  });

  try {
    if (tool.tool.validate_input !== false) {
      const v = validateArgs(tool, args);
      if (!v.valid) {
        log.toolCallEnd({
          tool: toolName,
          configId: tool.configId,
          requestId: caller?.requestId,
          caller: formatCaller(caller),
          callerCtx: caller,
          duration_ms: Date.now() - start,
          success: false,
          error: `validation_failed: ${v.errors.map((e) => `${e.path} ${e.issue}`).join(", ")}`,
        });
        return {
          success: false,
          status: 0,
          data: { error: "Invalid arguments", validation_errors: v.errors },
        };
      }
    }

    const connector = connectorRegistry.get(tool.connectorConfig.type);
    const result = await connector.execute(tool, args);

    log.toolCallEnd({
      tool: toolName,
      configId: tool.configId,
      requestId: caller?.requestId,
      caller: formatCaller(caller),
      callerCtx: caller,
      duration_ms: Date.now() - start,
      success: result.success,
    });

    return { ...result, data: stripResponse(result.data) };
  } catch (err) {
    if (err instanceof AuthNotConfiguredError) {
      log.toolCallEnd({
        tool: toolName,
        configId: tool.configId,
        requestId: caller?.requestId,
        caller: formatCaller(caller),
        callerCtx: caller,
        duration_ms: Date.now() - start,
        success: false,
        error: err.message,
      });
      return {
        success: false,
        status: 0,
        data: {
          error: `Auth not configured for service "${err.configId}"`,
          missing_env_vars: err.missingVars,
          fix: `Run: heku auth setup ${err.configId}`,
        },
      };
    }

    log.toolCallEnd({
      tool: toolName,
      configId: tool.configId,
      requestId: caller?.requestId,
      caller: formatCaller(caller),
      callerCtx: caller,
      duration_ms: Date.now() - start,
      success: false,
      error: (err as Error).message,
    });

    throw err;
  }
}

function formatCaller(ctx?: CallerContext): string | undefined {
  if (!ctx) return undefined;
  const parts = [ctx.requestId.slice(0, 8), ctx.transport];
  if (ctx.agentId)   parts.push(`agent:${ctx.agentId}`);
  if (ctx.chatId)    parts.push(`chat:${ctx.chatId}`);
  if (ctx.sessionId) parts.push(`session:${ctx.sessionId}`);
  if (ctx.source)    parts.push(`src:${ctx.source}`);
  if (ctx.ip)        parts.push(ctx.ip);
  return parts.join(" | ");
}
