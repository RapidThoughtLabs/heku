import { JSONPath } from "jsonpath-plus";
import { resolveAuth } from "../auth/index.js";
import type { HttpConnectorConfig, RegisteredTool } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
const USER_AGENT = "mcp-one/0.1.0";

// ── Types ─────────────────────────────────────────────────────────

interface PreparedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

// ── HTTP Connector ─────────────────────────────────────────────────

export class HttpConnector implements IConnector {
  readonly type = "http" as const;

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const config = tool.connectorConfig as HttpConnectorConfig;
    const req = this.buildRequest(tool, args, config);
    const res = await this.executeRequest(req);
    return this.mapResponse(res, tool, config);
  }

  // ── Path Param Interpolation ─────────────────────────────────────

  private interpolatePath(pathTemplate: string, params: Record<string, unknown>): string {
    return pathTemplate.replace(/\{(\w+)\}/g, (match, key: string) => {
      const val = params[key];
      if (val === undefined || val === null) {
        throw new Error(`Missing required path parameter: "${key}"`);
      }
      return encodeURIComponent(String(val));
    });
  }

  // ── Query String Construction ─────────────────────────────────────

  private buildQueryString(params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null,
    );
    if (entries.length === 0) return "";
    const qs = entries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `?${qs}`;
  }

  // ── Body Template Interpolation ───────────────────────────────────
  // Walks a JSON template recursively. If a value is a string like
  // "{{param_name}}", it's replaced with the raw param value.
  // If a placeholder is embedded in a larger string, e.g.
  // "Hello {{name}}!", the param value is stringified and spliced in.

  private interpolateTemplate(template: unknown, params: Record<string, unknown>): unknown {
    if (typeof template === "string") {
      // Exact match: entire value is a single placeholder → inject raw value
      const exactMatch = template.match(/^\{\{(\w+)\}\}$/);
      if (exactMatch) {
        const key = exactMatch[1];
        return params[key] !== undefined ? params[key] : null;
      }
      // Embedded placeholders: replace within the string
      return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
        const val = params[key];
        if (val === undefined || val === null) return "";
        return typeof val === "object" ? JSON.stringify(val) : String(val);
      });
    }

    if (Array.isArray(template)) {
      return template.map((item) => this.interpolateTemplate(item, params));
    }

    if (template !== null && typeof template === "object") {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(template as Record<string, unknown>)) {
        result[key] = this.interpolateTemplate(val, params);
      }
      return result;
    }

    return template;
  }

  // ── Response / Error Mapping ──────────────────────────────────────

  private applyJsonPathMap(
    map: Record<string, string>,
    json: unknown,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, pathExpr] of Object.entries(map)) {
      const matches = JSONPath({ path: pathExpr, json: json as object }) as unknown[];
      result[key] = matches.length === 1 ? matches[0] : matches.length === 0 ? null : matches;
    }
    return result;
  }

  // ── Build Request ─────────────────────────────────────────────────

  private buildRequest(
    tool: RegisteredTool,
    args: Record<string, unknown>,
    config: HttpConnectorConfig,
  ): PreparedRequest {
    const pathParams: Record<string, unknown> = {};
    const queryParams: Record<string, unknown> = {};
    const bodyParams: Record<string, unknown> = {};
    const headerParams: Record<string, string> = {};

    for (const paramDef of tool.tool.params) {
      let value = args[paramDef.name];

      // Apply defaults for missing values
      if (value === undefined && paramDef.default !== undefined) {
        value = paramDef.default;
      }

      if (value === undefined) continue;

      switch (paramDef.location) {
        case "path":
          pathParams[paramDef.name] = value;
          break;
        case "query":
          queryParams[paramDef.name] = value;
          break;
        case "body":
          bodyParams[paramDef.name] = value;
          break;
        case "header":
          headerParams[paramDef.name] = String(value);
          break;
      }
    }

    // Resolve URL
    const interpolatedPath = this.interpolatePath(tool.tool.path!, pathParams);
    const url =
      config.base_url.replace(/\/+$/, "") +
      interpolatedPath +
      this.buildQueryString(queryParams);

    // Resolve auth headers — may throw AuthNotConfiguredError
    const authHeaders = config.auth ? resolveAuth(config.auth, tool.configId) : {};

    // Merge headers: auth overrides Accept; user header params override auth
    const headers: Record<string, string> = {
      "Accept": "application/json",
      "User-Agent": USER_AGENT,
      ...authHeaders,
      ...headerParams,
    };

    // Build body
    let body: string | undefined;
    if (tool.tool.method !== "GET") {
      if (tool.tool.body_template) {
        const interpolated = this.interpolateTemplate(tool.tool.body_template, bodyParams);
        body = JSON.stringify(interpolated);
        headers["Content-Type"] = "application/json";
      } else if (Object.keys(bodyParams).length > 0) {
        body = JSON.stringify(bodyParams);
        headers["Content-Type"] = "application/json";
      } else {
        // Send an empty JSON body so APIs that require one don't reject the request
        body = "{}";
        headers["Content-Type"] = "application/json";
      }
    }

    return { url, method: tool.tool.method!, headers, body };
  }

  // ── Execute Request ───────────────────────────────────────────────

  private async executeRequest(req: PreparedRequest): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      return await fetch(req.url, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        throw new Error(
          `Request timed out after ${DEFAULT_TIMEOUT_MS / 1000}s: ${req.method} ${req.url}`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Map Response ──────────────────────────────────────────────────

  private async mapResponse(
    response: Response,
    tool: RegisteredTool,
    config: HttpConnectorConfig,
  ): Promise<ConnectorResult> {
    const status = response.status;
    let responseBody: unknown;

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    // ── 401 Unauthorized — surface as a clear auth failure ──────────
    if (status === 401) {
      return {
        success: false,
        status: 401,
        data: {
          error: "Authentication failed",
          service: tool.configId,
          auth_type: config.auth?.type ?? "none",
          hint:
            "Your token may have expired or is invalid. " +
            "Check your .env file and update the relevant environment variable, then retry.",
          api_response: responseBody,
        },
      };
    }

    if (response.ok) {
      const data = tool.tool.response_map
        ? this.applyJsonPathMap(tool.tool.response_map, responseBody)
        : responseBody;
      return { success: true, status, data };
    }

    // Error path — apply error_map if defined
    const data = tool.tool.error_map
      ? this.applyJsonPathMap(tool.tool.error_map, responseBody)
      : { error: response.statusText, status, body: responseBody };
    return { success: false, status, data };
  }
}
