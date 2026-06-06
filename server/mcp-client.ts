import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { VERSION } from "../src/lib/version.js";

// ── Types ──────────────────────────────────────────────────────────

export type McpStatus = "connecting" | "connected" | "disconnected";
export type McpTransportMode = "http";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  configId: string;
}

export interface LogEntry {
  id: number;
  ts: number;
  level: "info" | "warn" | "error" | "debug";
  source: "mcp" | "api" | "config";
  msg: string;
}

// ── Ring Buffer ────────────────────────────────────────────────────

const MAX_LOG = 500;
let logSeq = 0;

function makeLogEntry(
  level: LogEntry["level"],
  source: LogEntry["source"],
  msg: string,
): LogEntry {
  return { id: ++logSeq, ts: Date.now(), level, source, msg };
}

/** In HTTP mode the stateless transport cannot deliver server-initiated
 *  notifications (ToolListChanged).  Poll the tool list so config hot-reloads
 *  propagate to the Express API layer. */
const HTTP_TOOL_POLL_MS = 3_000;

// ── MCP Client Bridge ──────────────────────────────────────────────

export function createMcpClient() {
  let client: Client | null = null;
  let status: McpStatus = "disconnected";
  let currentEndpoint: string | null = null;
  let tools: McpTool[] = [];
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let httpPollTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = 1_000;
  /** true while the user wants a connection active; false after disconnect() */
  let active = false;
  let appShuttingDown = false;
  const logs: LogEntry[] = [];

  // ── Logging ───────────────────────────────────────────────────────

  function addLog(
    level: LogEntry["level"],
    source: LogEntry["source"],
    msg: string,
  ): void {
    const entry = makeLogEntry(level, source, msg);
    logs.push(entry);
    if (logs.length > MAX_LOG) logs.shift();
    console.error(`[${source}:${level}]`, msg);
  }

  // ── Tool refresh ──────────────────────────────────────────────────

  async function fetchTools(): Promise<void> {
    if (!client || status !== "connected") return;
    try {
      const result = await client.listTools();
      const prev = tools.length;
      tools = result.tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
        configId: t.name.includes(".") ? t.name.split(".")[0]! : "unknown",
      }));
      // Only log when count changes (avoids noise from polling)
      if (tools.length !== prev) {
        addLog("info", "mcp", `Tools refreshed: ${tools.length} tool(s) (was ${prev})`);
      }
    } catch (err) {
      addLog("error", "mcp", `Failed to fetch tools: ${(err as Error).message}`);
    }
  }

  // ── HTTP tool polling (compensates for missing notifications) ──────

  function startHttpToolPoll(): void {
    stopHttpToolPoll();
    const tick = async () => {
      if (!active || status !== "connected") return;
      await fetchTools();
      if (active && status === "connected") {
        httpPollTimer = setTimeout(tick, HTTP_TOOL_POLL_MS);
      }
    };
    httpPollTimer = setTimeout(tick, HTTP_TOOL_POLL_MS);
  }

  function stopHttpToolPoll(): void {
    if (httpPollTimer) {
      clearTimeout(httpPollTimer);
      httpPollTimer = null;
    }
  }

  // ── Reconnect ─────────────────────────────────────────────────────

  function scheduleReconnect(): void {
    if (!active || appShuttingDown || reconnectTimer || !currentEndpoint) return;
    addLog("info", "mcp", `Reconnecting in ${reconnectDelay / 1_000}s...`);
    const endpoint = currentEndpoint;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      try {
        await doConnect(endpoint);
      } catch {
        // doConnect already logged the error and scheduled next reconnect
      }
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  }

  // ── Connect via HTTP ──────────────────────────────────────────────

  async function doConnect(baseUrl: string): Promise<void> {
    let transport: StreamableHTTPClientTransport;
    try {
      transport = new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`),
        { requestInit: { headers: { "X-Source": "dashboard" } } },
      );
    } catch (err) {
      addLog("error", "mcp", `Invalid endpoint URL: ${(err as Error).message}`);
      status = "disconnected";
      scheduleReconnect();
      return;
    }

    client = new Client({ name: "mcp-one-api", version: VERSION }, {});

    client.onclose = () => {
      stopHttpToolPoll();
      if (!active || appShuttingDown) return;
      status = "disconnected";
      tools = [];
      client = null;
      addLog("warn", "mcp", "Connection closed — will reconnect");
      scheduleReconnect();
    };

    client.onerror = (err: Error) => {
      addLog("error", "mcp", `MCP client error: ${err.message}`);
    };

    try {
      await client.connect(transport);
    } catch (err) {
      const msg = (err as Error).message;
      addLog("error", "mcp", `Connection failed: ${msg}`);
      client = null;
      status = "disconnected";
      if (active) scheduleReconnect();
      throw new Error(`Connection failed: ${msg}`);
    }

    status = "connected";
    reconnectDelay = 1_000;
    addLog("info", "mcp", `Connected to mcp-one at ${baseUrl} ✓`);

    await fetchTools();

    // Notification handler — fires if the transport supports SSE.
    // Stateless HTTP typically cannot, so the poll below compensates.
    client.setNotificationHandler(
      ToolListChangedNotificationSchema,
      async () => {
        addLog("info", "mcp", "Tool list changed (hot reload)");
        await fetchTools();
      },
    );

    startHttpToolPoll();
  }

  // ── Cleanup helper ────────────────────────────────────────────────

  async function cleanupConnection(): Promise<void> {
    stopHttpToolPoll();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (client) {
      try { await client.close(); } catch { /* already dead */ }
      client = null;
    }
    status = "disconnected";
    tools = [];
  }

  // ── Public API ────────────────────────────────────────────────────

  return {
    getStatus: (): {
      status: McpStatus;
      toolCount: number;
      transportMode: McpTransportMode;
      endpoint: string | null;
    } => ({
      status,
      toolCount: tools.length,
      transportMode: "http",
      endpoint: currentEndpoint,
    }),

    listTools: (): McpTool[] => [...tools],

    /** Force an immediate tool list refresh from mcp-one. */
    refreshTools: async (): Promise<void> => {
      await fetchTools();
    },

    callTool: async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      if (!client || status !== "connected") {
        throw new Error("MCP server not connected");
      }
      const start = Date.now();
      try {
        const result = await client.callTool({ name, arguments: args });
        const ms = Date.now() - start;
        addLog("info", "mcp", `tools/call ${name} → OK (${ms}ms)`);
        return result;
      } catch (err) {
        const ms = Date.now() - start;
        addLog("error", "mcp", `tools/call ${name} → ERROR (${ms}ms): ${(err as Error).message}`);
        throw err;
      }
    },

    getLogs: (): LogEntry[] => [...logs],

    addLog,

    /** Connect to a specific mcp-one HTTP endpoint. Replaces any existing connection. */
    connectToEndpoint: async (endpoint: string): Promise<void> => {
      active = false;
      await cleanupConnection();

      currentEndpoint = endpoint.replace(/\/$/, "");
      active = true;
      reconnectDelay = 1_000;
      status = "connecting";
      addLog("info", "mcp", `Connecting to ${currentEndpoint}...`);

      await doConnect(currentEndpoint);
    },

    /** Disconnect and stay disconnected (user-initiated). */
    disconnect: async (): Promise<void> => {
      active = false;
      currentEndpoint = null;
      addLog("info", "mcp", "Disconnected by user");
      await cleanupConnection();
    },

    /** Full teardown on app shutdown. */
    shutdown: async (): Promise<void> => {
      appShuttingDown = true;
      active = false;
      await cleanupConnection();
    },
  };
}

export type McpClientInstance = ReturnType<typeof createMcpClient>;
