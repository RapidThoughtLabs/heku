import fs from "node:fs/promises";
import path from "node:path";
import type { FileConnectorConfig, RegisteredTool } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";

export class FileConnector implements IConnector {
  readonly type = "file" as const;

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const config = tool.connectorConfig as FileConnectorConfig;
    const filePath = this.resolvePath(tool.tool.path_template!, args, config.base_path);

    switch (tool.tool.operation) {
      case "read": {
        const content = await fs.readFile(filePath, "utf-8");
        return { success: true, data: { content, path: filePath } };
      }
      case "write": {
        const writeContent = this.interpolate(tool.tool.content_template!, args);
        await fs.writeFile(filePath, writeContent, "utf-8");
        return { success: true, data: { path: filePath, bytes: Buffer.byteLength(writeContent) } };
      }
      case "append": {
        const appendContent = this.interpolate(tool.tool.content_template!, args);
        await fs.appendFile(filePath, appendContent, "utf-8");
        return { success: true, data: { path: filePath } };
      }
      case "delete": {
        await fs.unlink(filePath);
        return { success: true, data: { path: filePath, deleted: true } };
      }
      case "list": {
        const entries = await fs.readdir(filePath, { withFileTypes: true });
        return {
          success: true,
          data: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" })),
        };
      }
      default:
        return { success: false, data: { error: `Unknown file operation: ${tool.tool.operation}` } };
    }
  }

  private resolvePath(template: string, args: Record<string, unknown>, basePath?: string): string {
    const interpolated = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = args[key];
      if (val === undefined) throw new Error(`Missing param: "${key}"`);
      return String(val);
    });

    const resolved = basePath
      ? path.resolve(basePath, interpolated)
      : path.resolve(interpolated);

    // Jail check: resolved path must be under basePath
    if (basePath && !resolved.startsWith(path.resolve(basePath) + path.sep) &&
        resolved !== path.resolve(basePath)) {
      throw new Error(`Path escape rejected: "${interpolated}" resolves outside base_path`);
    }

    return resolved;
  }

  private interpolate(template: string, args: Record<string, unknown>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = args[key];
      return val !== undefined ? String(val) : "";
    });
  }
}
