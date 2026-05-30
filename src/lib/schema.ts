import type { ParamDef } from "../types.js";

const MAX_SCHEMA_DEPTH = 10;

export const PARAM_TYPE_MAP: Record<ParamDef["type"], string> = {
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "object",
  array: "array",
};

export function paramToSchema(p: ParamDef): Record<string, unknown> {
  const node: Record<string, unknown> = {
    type: PARAM_TYPE_MAP[p.type],
    description: p.description,
  };
  if (p.default !== undefined) node.default = p.default;
  if (p.enum) node.enum = p.enum;
  if (p.format) node.format = p.format;

  if (p.type === "object" && p.properties) {
    const nestedProps: Record<string, unknown> = {};
    const nestedReq: string[] = [];
    for (const [k, child] of Object.entries(p.properties)) {
      nestedProps[k] = paramToSchema(child);
      if (child.required) nestedReq.push(k);
    }
    node.properties = nestedProps;
    if (nestedReq.length) node.required = nestedReq;
  }

  if (p.type === "array" && p.items) {
    node.items = paramToSchema(p.items);
  }

  return node;
}

export function schemaToParam(
  name: string,
  node: Record<string, unknown>,
  required: boolean,
  depth: number = 0,
  configId: string = "",
  paramPath: string = "",
): ParamDef {
  if (depth >= MAX_SCHEMA_DEPTH) {
    console.error(`[mcp-connector] "${configId}": param "${paramPath}" truncated at depth ${MAX_SCHEMA_DEPTH}`);
    return { name, type: "object", required, description: name };
  }

  const rawType = typeof node.type === "string" ? node.type : "";
  const type: ParamDef["type"] =
    rawType === "string" || rawType === "number" || rawType === "boolean" ||
    rawType === "object" || rawType === "array"
      ? (rawType as ParamDef["type"])
      : "string";

  const description = typeof node.description === "string" ? node.description : name;

  const param: ParamDef = { name, type, required, description, location: "body" };

  if (Array.isArray(node.enum)) param.enum = node.enum;
  if (typeof node.format === "string") param.format = node.format;
  if (node.default !== undefined) param.default = node.default;

  if (type === "object" && node.properties && typeof node.properties === "object") {
    const props = node.properties as Record<string, unknown>;
    const reqSet = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const properties: Record<string, ParamDef> = {};
    for (const [k, v] of Object.entries(props)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const childPath = paramPath ? `${paramPath}.${k}` : k;
        properties[k] = schemaToParam(k, v as Record<string, unknown>, reqSet.has(k), depth + 1, configId, childPath);
      }
    }
    param.properties = properties;
  }

  if (type === "array" && node.items && typeof node.items === "object" && !Array.isArray(node.items)) {
    const itemPath = paramPath ? `${paramPath}[]` : "items";
    const itemNode = node.items as Record<string, unknown>;
    const itemReq = typeof itemNode.required === "boolean" ? itemNode.required : false;
    param.items = schemaToParam("items", itemNode, itemReq, depth + 1, configId, itemPath);
  }

  return param;
}

export function buildInputSchema(params: ParamDef[]): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const p of params) {
    properties[p.name] = paramToSchema(p);
    if (p.required) required.push(p.name);
  }

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}
