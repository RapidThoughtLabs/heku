import type { ConnectorType, RegisteredTool } from "../types.js";

export interface ConnectorResult {
  success: boolean;
  status?: number;  // http status, exit code, etc.
  data: unknown;
}

export interface IConnector {
  readonly type: ConnectorType;

  /** Execute a tool call. Connector receives config data via tool.connectorConfig. */
  execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult>;

  /** Called once on server startup. MCP connector spawns child processes here. */
  init?(): Promise<void>;

  /** Called on SIGTERM/SIGINT. MCP connector kills children here. */
  teardown?(): Promise<void>;
}
