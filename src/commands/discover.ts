import { discoverMcpServers } from "../discovery.js";
import type { McpConnectorConfig } from "../types.js";

export async function run(): Promise<void> {
  const servers = discoverMcpServers();

  if (servers.length === 0) {
    console.log("No MCP servers found in known locations.");
    return;
  }

  console.log(`Found ${servers.length} MCP server(s):\n`);
  for (const s of servers) {
    const mc = s.connector as McpConnectorConfig;
    console.log(`  ${s.id}`);
    console.log(`    command: ${mc.command} ${(mc.args ?? []).join(" ")}`);
    console.log("");
  }
}
