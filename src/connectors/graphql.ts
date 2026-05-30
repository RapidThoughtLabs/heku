import { resolveAuth } from "../auth/index.js";
import type { GraphqlConnectorConfig, RegisteredTool, ToolDef, ParamDef } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";

// ── Internal types ─────────────────────────────────────────────────

interface GraphqlChild {
  configId: string;
  config: GraphqlConnectorConfig;
  tools: ToolDef[];
}

export interface GqlType {
  kind: string;
  name: string | null;
  ofType?: GqlType | null;
}

export interface GqlInputValue {
  name: string;
  description: string | null;
  type: GqlType;
  defaultValue: string | null;
}

interface GqlField {
  name: string;
  description: string | null;
  args: GqlInputValue[];
  type: GqlType;
}

export interface GqlEnumValue {
  name: string;
}

export interface GqlFullType {
  kind: string;
  name: string;
  description: string | null;
  fields: GqlField[] | null;
  inputFields: GqlInputValue[] | null;
  enumValues: GqlEnumValue[] | null;
}

interface GqlSchema {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  types: GqlFullType[];
}

// ── Constants ─────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;
// Depth 4 is sufficient for LLM-facing params; deeper schemas (e.g. Linear) cause
// exponential traversal with no practical benefit beyond level 3-4.
const MAX_PARAM_DEPTH = 4;

export const SCALAR_FORMAT_MAP: Record<string, string> = {
  DateTime: "date-time",
  Date: "date",
  UUID: "uuid",
};

const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      types {
        kind name description
        fields(includeDeprecated: false) {
          name description
          args { name description type { ...TypeRef } defaultValue }
          type { ...TypeRef }
        }
        inputFields { name description type { ...TypeRef } defaultValue }
        enumValues(includeDeprecated: false) { name }
      }
    }
  }
  fragment TypeRef on __Type {
    kind name ofType { kind name ofType { kind name ofType { kind name } } }
  }
`;

// ── Type mapping helpers ───────────────────────────────────────────

function unwrapType(t: GqlType): GqlType {
  if ((t.kind === "NON_NULL" || t.kind === "LIST") && t.ofType) {
    return unwrapType(t.ofType);
  }
  return t;
}

function resolveGqlType(
  name: string,
  description: string | null,
  t: GqlType,
  typeMap: Map<string, GqlFullType>,
  depth: number,
  visited: Set<string>,
  configId: string,
  paramPath: string,
  propsCache: Map<string, Record<string, ParamDef>>,
  stats: { cycles: number; truncations: number },
  defaultValue?: string | null,
): ParamDef {
  const required = t.kind === "NON_NULL";
  const innerType = required ? t.ofType! : t;

  // LIST → array with recursive items
  if (innerType.kind === "LIST") {
    const itemType = innerType.ofType!;
    const items = resolveGqlType("item", null, itemType, typeMap, depth, visited, configId, `${paramPath}[]`, propsCache, stats);
    return {
      name,
      type: "array",
      required,
      description: description ?? name,
      items,
      ...(defaultValue != null ? { default: defaultValue } : {}),
    };
  }

  const unwrapped = unwrapType(innerType);

  if (!unwrapped.name) {
    return { name, type: "string", required, description: description ?? name };
  }

  // ENUM → string + enum values
  if (unwrapped.kind === "ENUM") {
    const fullType = typeMap.get(unwrapped.name);
    const enumVals = (fullType?.enumValues ?? []).map((v) => v.name);
    return {
      name,
      type: "string",
      required,
      description: description ?? name,
      ...(enumVals.length > 0 ? { enum: enumVals } : {}),
      ...(defaultValue != null ? { default: defaultValue } : {}),
    };
  }

  // INPUT_OBJECT → recursive properties
  if (unwrapped.kind === "INPUT_OBJECT") {
    if (depth >= MAX_PARAM_DEPTH) {
      stats.truncations++;
      return { name, type: "object", required, description: description ?? name };
    }
    if (visited.has(unwrapped.name)) {
      stats.cycles++;
      return { name, type: "object", required, description: description ?? name };
    }

    // Reuse already-resolved properties to avoid re-traversing the same type
    // (common in filter-heavy schemas like Linear where IssueFilter appears in many fields)
    if (propsCache.has(unwrapped.name)) {
      return {
        name,
        type: "object",
        required,
        description: description ?? unwrapped.name,
        properties: propsCache.get(unwrapped.name)!,
        ...(defaultValue != null ? { default: defaultValue } : {}),
      };
    }

    const fullType = typeMap.get(unwrapped.name);
    if (!fullType?.inputFields?.length) {
      return { name, type: "object", required, description: description ?? unwrapped.name };
    }

    const newVisited = new Set(visited);
    newVisited.add(unwrapped.name);
    const properties: Record<string, ParamDef> = {};
    for (const field of fullType.inputFields) {
      const fieldPath = `${paramPath}.${field.name}`;
      properties[field.name] = resolveGqlType(
        field.name, field.description, field.type,
        typeMap, depth + 1, newVisited, configId, fieldPath, propsCache, stats, field.defaultValue,
      );
    }
    propsCache.set(unwrapped.name, properties);
    return {
      name,
      type: "object",
      required,
      description: description ?? unwrapped.name,
      properties,
      ...(defaultValue != null ? { default: defaultValue } : {}),
    };
  }

  // SCALAR
  if (unwrapped.kind === "SCALAR") {
    switch (unwrapped.name) {
      case "String":
      case "ID":
        return { name, type: "string", required, description: description ?? name, ...(defaultValue != null ? { default: defaultValue } : {}) };
      case "Int":
      case "Float":
        return { name, type: "number", required, description: description ?? name, ...(defaultValue != null ? { default: defaultValue } : {}) };
      case "Boolean":
        return { name, type: "boolean", required, description: description ?? name, ...(defaultValue != null ? { default: defaultValue } : {}) };
      default: {
        const format = SCALAR_FORMAT_MAP[unwrapped.name];
        return {
          name,
          type: "string",
          required,
          description: description ?? name,
          ...(format ? { format } : {}),
          ...(defaultValue != null ? { default: defaultValue } : {}),
        };
      }
    }
  }

  // OBJECT / unknown — fall back to string
  return { name, type: "string", required, description: description ?? name };
}

export function argToParamDef(
  arg: GqlInputValue,
  typeMap: Map<string, GqlFullType>,
  depth: number,
  visited: Set<string>,
  configId: string,
  propsCache: Map<string, Record<string, ParamDef>> = new Map(),
  stats: { cycles: number; truncations: number } = { cycles: 0, truncations: 0 },
): ParamDef {
  return resolveGqlType(arg.name, arg.description, arg.type, typeMap, depth, visited, configId, arg.name, propsCache, stats, arg.defaultValue);
}

/** Render a GraphQL type reference as a type signature string */
function gqlTypeSig(t: GqlType): string {
  if (t.kind === "NON_NULL") return `${gqlTypeSig(t.ofType!)}!`;
  if (t.kind === "LIST") return `[${gqlTypeSig(t.ofType!)}]`;
  return t.name ?? "String";
}

/** Build a shallow scalar selection set up to depth 2 */
function buildSelectionSet(typeName: string | null, allTypes: GqlFullType[], depth: number): string {
  if (depth <= 0 || !typeName) return "";
  const fullType = allTypes.find((t) => t.name === typeName);
  if (!fullType || !fullType.fields) return "";

  const parts: string[] = [];
  for (const field of fullType.fields) {
    const innerType = unwrapType(field.type);
    const isScalar = innerType.kind === "SCALAR" || innerType.kind === "ENUM";
    if (isScalar) {
      parts.push(field.name);
    } else if (depth > 1 && innerType.kind === "OBJECT") {
      const nested = buildSelectionSet(innerType.name, allTypes, depth - 1);
      if (nested) parts.push(`${field.name} { ${nested} }`);
    }
  }
  return parts.join(" ");
}

/** Auto-generate a GraphQL operation string for a discovered field */
function buildOperationQuery(
  fieldName: string,
  args: GqlInputValue[],
  returnType: GqlType,
  allTypes: GqlFullType[],
  isMutation: boolean,
): string {
  const opType = isMutation ? "mutation" : "query";
  const returnTypeName = unwrapType(returnType).name;
  const selectionSet = buildSelectionSet(returnTypeName, allTypes, 2);

  const varDefs = args.map((arg) => `$${arg.name}: ${gqlTypeSig(arg.type)}`).join(", ");
  const argPassing = args.map((arg) => `${arg.name}: $${arg.name}`).join(", ");
  const selection = selectionSet ? `{ ${selectionSet} }` : "";

  const opName = fieldName.charAt(0).toUpperCase() + fieldName.slice(1);
  const varDefsStr = varDefs ? `(${varDefs})` : "";
  const argPassingStr = argPassing ? `(${argPassing})` : "";

  return `${opType} ${opName}${varDefsStr} { ${fieldName}${argPassingStr} ${selection} }`.trim();
}

// ── Template interpolation ─────────────────────────────────────────

function interpolateTemplate(template: unknown, params: Record<string, unknown>): unknown {
  if (typeof template === "string") {
    const exactMatch = template.match(/^\{\{(\w+)\}\}$/);
    if (exactMatch) {
      const key = exactMatch[1];
      return params[key] !== undefined ? params[key] : null;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const val = params[key];
      if (val === undefined || val === null) return "";
      return typeof val === "object" ? JSON.stringify(val) : String(val);
    });
  }
  if (Array.isArray(template)) return template.map((item) => interpolateTemplate(item, params));
  if (template !== null && typeof template === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(template as Record<string, unknown>)) {
      result[key] = interpolateTemplate(val, params);
    }
    return result;
  }
  return template;
}

// ── GraphQL Connector ──────────────────────────────────────────────

export class GraphqlConnector implements IConnector {
  readonly type = "graphql" as const;

  private children = new Map<string, GraphqlChild>();
  private pendingConfigs: Array<{
    configId: string;
    config: GraphqlConnectorConfig;
    overlays?: Record<string, { description?: string }>;
  }> = [];

  addConfig(
    configId: string,
    config: GraphqlConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): void {
    this.pendingConfigs.push({ configId, config, overlays });
  }

  async init(): Promise<void> {
    const results = await Promise.allSettled(
      this.pendingConfigs.map(({ configId, config, overlays }) =>
        this.introspect(configId, config, overlays),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const { configId } = this.pendingConfigs[i];
      if (r.status === "rejected") {
        console.error(`[graphql-connector] Failed to introspect "${configId}":`, r.reason);
      }
    }

    this.pendingConfigs = [];
  }

  getDiscoveredTools(configId: string): ToolDef[] {
    return this.children.get(configId)?.tools ?? [];
  }

  async reinitConfig(
    configId: string,
    config: GraphqlConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): Promise<void> {
    this.children.delete(configId);
    try {
      await this.introspect(configId, config, overlays);
    } catch (err) {
      console.error(`[graphql-connector] Failed to re-introspect "${configId}":`, err);
    }
  }

  async teardown(): Promise<void> {
    this.children.clear();
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const config = tool.connectorConfig as GraphqlConnectorConfig;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (config.auth) {
      try {
        const authHeaders = resolveAuth(config.auth, tool.configId);
        Object.assign(headers, authHeaders);
      } catch (err) {
        return { success: false, data: { error: (err as Error).message } };
      }
    }

    if (config.headers) Object.assign(headers, config.headers);

    const query = tool.tool.query;
    if (!query) {
      return { success: false, data: { error: "No query defined for this tool" } };
    }

    const variables: Record<string, unknown> = tool.tool.variables_template
      ? (interpolateTemplate(tool.tool.variables_template, args) as Record<string, unknown>)
      : args;

    const timeout = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if ((err as Error).name === "AbortError") {
        return { success: false, data: { error: `Request timed out after ${timeout / 1000}s` } };
      }
      return { success: false, data: { error: (err as Error).message } };
    } finally {
      clearTimeout(timeoutId);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { success: false, data: { error: "Invalid JSON response", status: response.status } };
    }

    const envelope = body as { data?: unknown; errors?: unknown[] };

    if (envelope.errors && envelope.data == null) {
      return { success: false, data: { errors: envelope.errors } };
    }

    if (envelope.data !== undefined) {
      let data = envelope.data;
      if (tool.tool.response_map && typeof data === "object" && data !== null) {
        const mapped: Record<string, unknown> = {};
        for (const [key, pathKey] of Object.entries(tool.tool.response_map)) {
          mapped[key] = (data as Record<string, unknown>)[pathKey];
        }
        data = mapped;
      }
      return { success: true, data };
    }

    return { success: false, data: { error: response.statusText, status: response.status } };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async introspect(
    configId: string,
    config: GraphqlConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): Promise<void> {
    const shouldIntrospect = config.introspect !== false;
    if (!shouldIntrospect) {
      this.children.set(configId, { configId, config, tools: [] });
      console.error(`[graphql-connector] Introspection disabled for "${configId}"`);
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };

    if (config.auth) {
      try {
        const authHeaders = resolveAuth(config.auth, configId);
        Object.assign(headers, authHeaders);
      } catch (err) {
        console.error(`[graphql-connector] Auth error for "${configId}":`, (err as Error).message);
      }
    }

    if (config.headers) Object.assign(headers, config.headers);

    const timeout = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    let response: Response;
    try {
      response = await fetch(config.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: INTROSPECTION_QUERY }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      const msg =
        (err as Error).name === "AbortError"
          ? `Introspection timed out after ${timeout / 1000}s`
          : (err as Error).message;
      console.error(`[graphql-connector] "${configId}" introspection failed: ${msg}`);
      this.children.set(configId, { configId, config, tools: [] });
      return;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      console.error(`[graphql-connector] "${configId}" introspection HTTP ${response.status}`);
      this.children.set(configId, { configId, config, tools: [] });
      return;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      console.error(`[graphql-connector] "${configId}" introspection returned non-JSON`);
      this.children.set(configId, { configId, config, tools: [] });
      return;
    }

    const schema = (body as { data?: { __schema?: GqlSchema } })?.data?.__schema;
    if (!schema) {
      console.error(`[graphql-connector] "${configId}" introspection missing __schema`);
      this.children.set(configId, { configId, config, tools: [] });
      return;
    }

    const tools = this.buildTools(configId, config, schema, overlays);
    this.children.set(configId, { configId, config, tools });
    console.error(
      `[graphql-connector] Introspected "${configId}" — ${tools.length} tools discovered`,
    );
  }

  private buildTools(
    configId: string,
    config: GraphqlConnectorConfig,
    schema: GqlSchema,
    overlays?: Record<string, { description?: string }>,
  ): ToolDef[] {
    const tools: ToolDef[] = [];
    const includeQueries = config.include_queries !== false;
    const includeMutations = config.include_mutations !== false;

    const queryTypeName = schema.queryType?.name ?? null;
    const mutationTypeName = schema.mutationType?.name ?? null;

    const typeMap = new Map<string, GqlFullType>();
    for (const t of schema.types) typeMap.set(t.name, t);

    // Shared across all fields — each INPUT_OBJECT type is traversed only once
    const propsCache = new Map<string, Record<string, ParamDef>>();
    const stats = { cycles: 0, truncations: 0 };

    const processType = (typeName: string | null, isMutation: boolean) => {
      if (!typeName) return;
      const typeObj = typeMap.get(typeName);
      if (!typeObj || !typeObj.fields) return;

      for (const field of typeObj.fields) {
        if (field.name.startsWith("__")) continue;

        const params: ParamDef[] = field.args.map((arg) =>
          argToParamDef(arg, typeMap, 0, new Set(), configId, propsCache, stats),
        );
        const overlay = overlays?.[field.name];
        const autoDescription = isMutation
          ? `GraphQL mutation: ${field.name}`
          : `GraphQL query: ${field.name}`;
        const description = overlay?.description ?? field.description ?? autoDescription;

        const query = buildOperationQuery(
          field.name,
          field.args,
          field.type,
          schema.types,
          isMutation,
        );

        const variablesTemplate: Record<string, unknown> = {};
        for (const arg of field.args) {
          variablesTemplate[arg.name] = `{{${arg.name}}}`;
        }

        tools.push({
          name: field.name,
          description,
          params,
          query,
          ...(field.args.length > 0 ? { variables_template: variablesTemplate } : {}),
        });
      }
    };

    if (includeQueries) processType(queryTypeName, false);
    if (includeMutations) processType(mutationTypeName, true);

    if (stats.cycles + stats.truncations > 0) {
      console.error(
        `[graphql-connector] "${configId}": schema traversal — ` +
        `${stats.cycles} cycle(s) stopped, ${stats.truncations} type(s) truncated at depth ${MAX_PARAM_DEPTH}`,
      );
    }

    return tools;
  }
}
