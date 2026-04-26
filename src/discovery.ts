import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { McpConfig, McpConnectorConfig } from "./types.js";

const SCAN_PATHS = [
  // Claude Desktop (macOS)
  () => path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  // Claude Desktop (Linux)
  () => path.join(os.homedir(), ".config", "claude", "claude_desktop_config.json"),
  // Cursor
  () => path.join(os.homedir(), ".cursor", "mcp.json"),
];

interface DiscoveredServer {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export function discoverMcpServers(): McpConfig[] {
  const discovered: McpConfig[] = [];
  const seenIds = new Set<string>();

  for (const getPath of SCAN_PATHS) {
    const configPath = getPath();
    if (!fs.existsSync(configPath)) continue;

    try {
      const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const servers = parseMcpClientConfig(raw);

      for (const srv of servers) {
        const id = `${srv.id}-mcp`; // D1: always append connector type suffix
        if (seenIds.has(id)) continue;
        seenIds.add(id);

        const connector: McpConnectorConfig = {
          type: "mcp",
          transport: "stdio",
          command: srv.command,
          args: srv.args,
          env: srv.env,
        };

        discovered.push({
          id,
          name: srv.id,
          description: `Auto-discovered MCP server: ${srv.id}`,
          connector,
          tools: [],
        });

        console.error(`[discovery] Found: ${id} (from ${path.basename(configPath)})`);
      }
    } catch (err) {
      console.error(`[discovery] Failed to parse ${configPath}:`, (err as Error).message);
    }
  }

  return discovered;
}

function parseMcpClientConfig(raw: unknown): DiscoveredServer[] {
  const servers: DiscoveredServer[] = [];
  if (!raw || typeof raw !== "object") return servers;

  const r = raw as Record<string, unknown>;
  const mcpServers = r.mcpServers as Record<string, unknown> | undefined;
  if (!mcpServers || typeof mcpServers !== "object") return servers;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (!config || typeof config !== "object") continue;
    const c = config as Record<string, unknown>;
    if (typeof c.command !== "string") continue;

    servers.push({
      id: name,
      command: c.command,
      args: Array.isArray(c.args) ? (c.args as string[]) : undefined,
      env: c.env && typeof c.env === "object" ? (c.env as Record<string, string>) : undefined,
    });
  }

  return servers;
}
