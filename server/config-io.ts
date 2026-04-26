import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
export const CONFIGS_DIR = path.join(ROOT, "mcp-configs");

// ── Shared Types (also used by the client via /api) ───────────────

export interface AuthStatus {
  type: string;
  ok: boolean;
  missingVars: string[];
}

export interface ConfigSummary {
  id: string;
  name: string;
  description?: string;
  connector: {
    type: string;
    base_url?: string;
    endpoint?: string;
    transport?: string;
  };
  toolCount: number;
  auth?: AuthStatus;
  raw: Record<string, unknown>; // full parsed JSON for the editor
}

export interface ValidationError {
  field: string;
  message: string;
}

export interface WriteResult {
  ok: boolean;
  errors?: ValidationError[];
}

// ── Auth Env Var Check ────────────────────────────────────────────

function getMissingAuthVars(auth: unknown): string[] {
  if (!auth || typeof auth !== "object") return [];
  const a = auth as Record<string, unknown>;

  const candidates: string[] = [];

  if (a["type"] === "bearer" || a["type"] === "oauth2_static") {
    if (typeof a["token_env"] === "string") candidates.push(a["token_env"]);
  } else if (a["type"] === "basic") {
    if (typeof a["username_env"] === "string") candidates.push(a["username_env"]);
    if (typeof a["token_env"] === "string") candidates.push(a["token_env"]);
  } else if (a["type"] === "api_key") {
    if (typeof a["key_env"] === "string") candidates.push(a["key_env"]);
  }

  return candidates.filter((v) => !process.env[v]);
}

// ── Connector Summary ─────────────────────────────────────────────

function extractConnectorSummary(
  connector: Record<string, unknown>,
): ConfigSummary["connector"] {
  const type = String(connector["type"] ?? "unknown");
  const result: ConfigSummary["connector"] = { type };

  if (connector["base_url"]) result.base_url = String(connector["base_url"]);
  if (connector["endpoint"]) result.endpoint = String(connector["endpoint"]);
  if (connector["transport"]) result.transport = String(connector["transport"]);

  return result;
}

// ── Validation ────────────────────────────────────────────────────

const VALID_CONNECTOR_TYPES = ["http", "cli", "file", "grpc", "graphql", "mcp"];

export function validateConfigShape(
  data: unknown,
): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!data || typeof data !== "object") {
    return [{ field: "root", message: "Config must be a JSON object" }];
  }
  const d = data as Record<string, unknown>;

  if (!d["id"] || typeof d["id"] !== "string") {
    errors.push({ field: "id", message: '"id" must be a non-empty string' });
  }
  if (!d["name"] || typeof d["name"] !== "string") {
    errors.push({ field: "name", message: '"name" must be a non-empty string' });
  }
  if (!d["connector"] || typeof d["connector"] !== "object") {
    errors.push({ field: "connector", message: '"connector" must be an object' });
  } else {
    const conn = d["connector"] as Record<string, unknown>;
    if (!VALID_CONNECTOR_TYPES.includes(String(conn["type"] ?? ""))) {
      errors.push({
        field: "connector.type",
        message: `connector.type must be one of: ${VALID_CONNECTOR_TYPES.join(", ")}`,
      });
    }
  }
  if (!Array.isArray(d["tools"])) {
    errors.push({ field: "tools", message: '"tools" must be an array' });
  } else {
    const connType =
      d["connector"] && typeof d["connector"] === "object"
        ? String((d["connector"] as Record<string, unknown>)["type"] ?? "")
        : "";
    const DISCOVERABLE_TYPES = ["mcp", "graphql", "grpc"];
    if (!DISCOVERABLE_TYPES.includes(connType) && (d["tools"] as unknown[]).length === 0) {
      errors.push({
        field: "tools",
        message: `"tools" must not be empty (unless connector type is one of: ${DISCOVERABLE_TYPES.join(", ")})`,
      });
    }
    // Validate tool names
    (d["tools"] as unknown[]).forEach((t, i) => {
      if (!t || typeof t !== "object") {
        errors.push({ field: `tools[${i}]`, message: "Each tool must be an object" });
        return;
      }
      const tool = t as Record<string, unknown>;
      if (!tool["name"] || typeof tool["name"] !== "string") {
        errors.push({ field: `tools[${i}].name`, message: `tools[${i}].name must be a non-empty string` });
      }
    });
  }

  return errors;
}

// ── File Helpers ──────────────────────────────────────────────────

function configFilePath(id: string): string {
  return path.join(CONFIGS_DIR, `mcp.${id}.json`);
}

function readConfigFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toConfigSummary(raw: Record<string, unknown>): ConfigSummary {
  const id = String(raw["id"] ?? "");
  const name = String(raw["name"] ?? "");
  const description =
    typeof raw["description"] === "string" ? raw["description"] : undefined;

  const connector =
    raw["connector"] && typeof raw["connector"] === "object"
      ? extractConnectorSummary(raw["connector"] as Record<string, unknown>)
      : { type: "unknown" };

  const tools = Array.isArray(raw["tools"]) ? raw["tools"] : [];
  const toolCount = tools.length;

  // Auth status (HTTP and GraphQL only)
  let auth: AuthStatus | undefined;
  if (
    raw["connector"] &&
    typeof raw["connector"] === "object"
  ) {
    const conn = raw["connector"] as Record<string, unknown>;
    if (conn["type"] === "http" || conn["type"] === "graphql") {
      const authData = conn["auth"];
      const missingVars = getMissingAuthVars(authData);
      auth = {
        type: typeof authData === "object" && authData
          ? String((authData as Record<string, unknown>)["type"] ?? "unknown")
          : "none",
        ok: missingVars.length === 0,
        missingVars,
      };
    }
  }

  return { id, name, description, connector, toolCount, auth, raw };
}

// ── Public API ────────────────────────────────────────────────────

export function listConfigs(): ConfigSummary[] {
  if (!fs.existsSync(CONFIGS_DIR)) return [];

  return fs
    .readdirSync(CONFIGS_DIR)
    .filter((f) => f.startsWith("mcp.") && f.endsWith(".json"))
    .map((f) => readConfigFile(path.join(CONFIGS_DIR, f)))
    .filter((raw): raw is Record<string, unknown> => raw !== null)
    .map(toConfigSummary);
}

export function getConfig(id: string): ConfigSummary | null {
  const filePath = configFilePath(id);
  if (!fs.existsSync(filePath)) return null;
  const raw = readConfigFile(filePath);
  if (!raw) return null;
  return toConfigSummary(raw);
}

export function createConfig(data: unknown): WriteResult {
  if (!data || typeof data !== "object") {
    return {
      ok: false,
      errors: [{ field: "root", message: "Body must be a JSON object" }],
    };
  }
  const d = data as Record<string, unknown>;
  const errors = validateConfigShape(d);
  if (errors.length > 0) return { ok: false, errors };

  const id = String(d["id"]);
  const filePath = configFilePath(id);

  if (fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [{ field: "id", message: `Config "${id}" already exists (mcp.${id}.json)` }],
    };
  }

  fs.mkdirSync(CONFIGS_DIR, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(d, null, 2) + "\n", "utf-8");
  return { ok: true };
}

export function updateConfig(id: string, data: unknown): WriteResult {
  const filePath = configFilePath(id);
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [{ field: "id", message: `Config "${id}" not found` }],
    };
  }

  if (!data || typeof data !== "object") {
    return {
      ok: false,
      errors: [{ field: "root", message: "Body must be a JSON object" }],
    };
  }
  const d = data as Record<string, unknown>;

  // Ensure the id in the body matches the URL param
  const bodyId = typeof d["id"] === "string" ? d["id"] : id;
  if (bodyId !== id) {
    return {
      ok: false,
      errors: [{ field: "id", message: `Config id in body ("${bodyId}") does not match URL id ("${id}")` }],
    };
  }

  const errors = validateConfigShape({ ...d, id });
  if (errors.length > 0) return { ok: false, errors };

  fs.writeFileSync(filePath, JSON.stringify({ ...d, id }, null, 2) + "\n", "utf-8");
  return { ok: true };
}

export function deleteConfig(id: string): WriteResult {
  const filePath = configFilePath(id);
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      errors: [{ field: "id", message: `Config "${id}" not found` }],
    };
  }
  fs.unlinkSync(filePath);
  return { ok: true };
}
