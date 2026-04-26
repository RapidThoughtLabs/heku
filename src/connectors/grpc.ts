import fs from "node:fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import protobuf from "protobufjs";
import { resolveAuth } from "../auth/index.js";
import type { GrpcConnectorConfig, RegisteredTool, ToolDef, ParamDef } from "../types.js";
import type { IConnector, ConnectorResult } from "./base.js";

// ── Internal types ─────────────────────────────────────────────────

interface GrpcChild {
  configId: string;
  config: GrpcConnectorConfig;
  clients: Map<string, grpc.Client>;   // fqServiceName → client instance
  tools: ToolDef[];
}

// ── Constants ──────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Credential builder ─────────────────────────────────────────────

function buildCredentials(tls: GrpcConnectorConfig["tls"]): grpc.ChannelCredentials {
  if (!tls) return grpc.credentials.createInsecure();
  if (tls === true) return grpc.credentials.createSsl();
  // Mutual TLS
  const rootCerts = tls.ca_cert_path ? fs.readFileSync(tls.ca_cert_path) : null;
  const privateKey = tls.client_key_path ? fs.readFileSync(tls.client_key_path) : null;
  const certChain = tls.client_cert_path ? fs.readFileSync(tls.client_cert_path) : null;
  return grpc.credentials.createSsl(rootCerts, privateKey, certChain);
}

// ── Auth → gRPC Metadata ───────────────────────────────────────────

function buildMetadata(
  auth: GrpcConnectorConfig["auth"],
  configId: string,
  staticMeta?: Record<string, string>,
): grpc.Metadata {
  const meta = new grpc.Metadata();
  if (auth) {
    try {
      const headers = resolveAuth(auth, configId);
      for (const [k, v] of Object.entries(headers)) meta.add(k, v);
    } catch (err) {
      console.error(`[grpc-connector] Auth error for "${configId}":`, (err as Error).message);
    }
  }
  if (staticMeta) {
    for (const [k, v] of Object.entries(staticMeta)) meta.add(k, v);
  }
  return meta;
}

// ── Type mapping ───────────────────────────────────────────────────

function protoFieldToParamType(field: protobuf.Field): ParamDef["type"] {
  if (field.repeated) return "array";
  if (field instanceof protobuf.MapField) return "object";
  switch (field.type) {
    case "string":
    case "bytes":
      return "string";
    case "int32":
    case "int64":
    case "uint32":
    case "uint64":
    case "sint32":
    case "sint64":
    case "fixed32":
    case "fixed64":
    case "sfixed32":
    case "sfixed64":
    case "float":
    case "double":
      return "number";
    case "bool":
      return "boolean";
    default:
      return "object"; // message types, enums
  }
}

function fieldDescription(field: protobuf.Field): string {
  const parts: string[] = [];
  if (field.comment) parts.push(field.comment);
  if (field.type === "bytes") parts.push("(base64-encoded)");
  if (field.repeated) parts.push("(repeated)");
  if (field instanceof protobuf.MapField) {
    parts.push(`(map<${field.keyType}, ${field.type}>)`);
  }
  // Resolved type is an enum — list values
  if (field.resolvedType instanceof protobuf.Enum) {
    const values = Object.keys(field.resolvedType.values).join(", ");
    parts.push(`Enum values: ${values}`);
  }
  return parts.join(" ") || field.name;
}

// ── Tool generation from protobufjs service ────────────────────────

function serviceToTools(
  service: protobuf.Service,
  serviceFilter: string | undefined,
  overlays: Record<string, { description?: string }> | undefined,
): ToolDef[] {
  const tools: ToolDef[] = [];
  const shortName = service.name;
  const fqName = service.fullName.startsWith(".") ? service.fullName.slice(1) : service.fullName;

  if (serviceFilter && shortName !== serviceFilter && fqName !== serviceFilter) return [];

  for (const method of service.methodsArray) {
    // Skip streaming methods
    if (method.requestStream || method.responseStream) {
      const streamType = method.requestStream && method.responseStream
        ? "bidi-streaming"
        : method.requestStream ? "client-streaming" : "server-streaming";
      console.error(
        `[grpc-connector] Skipping ${shortName}.${method.name} (${streamType} — not yet supported)`,
      );
      continue;
    }

    const toolName = `${shortName}_${method.name}`;
    const overlayKey1 = method.name;
    const overlayKey2 = toolName;
    const overlay = overlays?.[overlayKey2] ?? overlays?.[overlayKey1];

    // Build params from request message fields
    const params: ParamDef[] = [];
    const reqType = method.resolvedRequestType;
    if (reqType) {
      for (const field of reqType.fieldsArray) {
        params.push({
          name: field.name,
          type: protoFieldToParamType(field),
          required: field.required,
          description: fieldDescription(field),
        });
      }
    }

    const autoDescription = buildAutoDescription(shortName, method.name, params);
    const description = overlay?.description ?? method.comment ?? autoDescription;

    tools.push({
      name: toolName,
      description,
      params,
      service: fqName,
      rpc_method: method.name,
    });
  }

  return tools;
}

function buildAutoDescription(serviceName: string, methodName: string, params: ParamDef[]): string {
  if (params.length === 0) {
    return `Call ${methodName} on ${serviceName}`;
  }
  const fieldList = params
    .slice(0, 5)
    .map((p) => `${p.name} (${p.type}${p.required ? ", required" : ""})`)
    .join(", ");
  const extra = params.length > 5 ? `, +${params.length - 5} more` : "";
  return `Call ${methodName} on ${serviceName}. Fields: ${fieldList}${extra}`;
}

// ── Walk protobufjs root for all services ──────────────────────────

function findServices(ns: protobuf.NamespaceBase): protobuf.Service[] {
  const found: protobuf.Service[] = [];
  for (const nested of ns.nestedArray) {
    if (nested instanceof protobuf.Service) {
      found.push(nested);
    } else if (nested instanceof protobuf.Namespace) {
      found.push(...findServices(nested));
    }
  }
  return found;
}

// ── Walk grpcObject tree for service client constructors ───────────

function extractServiceClients(
  obj: grpc.GrpcObject,
  credentials: grpc.ChannelCredentials,
  endpoint: string,
  prefix = "",
): Map<string, grpc.Client> {
  const clients = new Map<string, grpc.Client>();
  for (const [key, val] of Object.entries(obj)) {
    const fqKey = prefix ? `${prefix}.${key}` : key;
    if (typeof val === "function") {
      // ServiceClientConstructor
      const Ctor = val as grpc.ServiceClientConstructor;
      try {
        const client = new Ctor(endpoint, credentials);
        clients.set(fqKey, client);
        clients.set(key, client); // also by short name
      } catch { /* not a valid service client */ }
    } else if (val && typeof val === "object" && !Buffer.isBuffer(val)) {
      const sub = extractServiceClients(
        val as grpc.GrpcObject,
        credentials,
        endpoint,
        fqKey,
      );
      sub.forEach((v, k) => clients.set(k, v));
    }
  }
  return clients;
}

// ── Proto-file discovery (Mode 1) ──────────────────────────────────

async function discoverFromProto(
  configId: string,
  config: GrpcConnectorConfig,
  overlays: Record<string, { description?: string }> | undefined,
): Promise<{ tools: ToolDef[]; clients: Map<string, grpc.Client> }> {
  const protoPath = config.proto_path!;

  // Use protobufjs for rich type discovery
  const root = new protobuf.Root();
  if (config.proto_include_dirs) {
    root.resolvePath = (_origin: string, target: string) => {
      for (const dir of config.proto_include_dirs!) {
        const full = `${dir}/${target}`;
        if (fs.existsSync(full)) return full;
      }
      return target;
    };
  }
  await root.load(protoPath, { keepCase: true });
  await root.resolveAll();

  const services = findServices(root);
  if (services.length === 0) {
    console.error(`[grpc-connector] "${configId}" no services found in proto file`);
    return { tools: [], clients: new Map() };
  }

  const tools: ToolDef[] = [];
  for (const service of services) {
    tools.push(...serviceToTools(service, config.service_filter, overlays));
  }

  // Create gRPC service clients via proto-loader (handles serialization)
  const packageDef = await protoLoader.load(protoPath, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
    includeDirs: config.proto_include_dirs,
  });
  const grpcObject = grpc.loadPackageDefinition(packageDef);
  const credentials = buildCredentials(config.tls);
  const clients = extractServiceClients(grpcObject, credentials, config.endpoint);

  console.error(
    `[grpc-connector] "${configId}" discovered ${tools.length} tool(s) from ${services.length} service(s)`,
  );

  return { tools, clients };
}

// ── GrpcConnector ──────────────────────────────────────────────────

export class GrpcConnector implements IConnector {
  readonly type = "grpc" as const;

  private children = new Map<string, GrpcChild>();
  private pendingConfigs: Array<{
    configId: string;
    config: GrpcConnectorConfig;
    overlays?: Record<string, { description?: string }>;
  }> = [];

  addConfig(
    configId: string,
    config: GrpcConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): void {
    this.pendingConfigs.push({ configId, config, overlays });
  }

  async init(): Promise<void> {
    const results = await Promise.allSettled(
      this.pendingConfigs.map(({ configId, config, overlays }) =>
        this.discover(configId, config, overlays),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const { configId } = this.pendingConfigs[i];
      if (r.status === "rejected") {
        console.error(`[grpc-connector] Failed to discover "${configId}":`, r.reason);
        this.children.set(configId, {
          configId,
          config: this.pendingConfigs[i].config,
          clients: new Map(),
          tools: [],
        });
      }
    }

    this.pendingConfigs = [];
  }

  getDiscoveredTools(configId: string): ToolDef[] {
    return this.children.get(configId)?.tools ?? [];
  }

  async reinitConfig(
    configId: string,
    config: GrpcConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): Promise<void> {
    // Tear down existing clients for this config
    const old = this.children.get(configId);
    if (old) {
      for (const client of old.clients.values()) {
        try { grpc.closeClient(client); } catch { /* ignore */ }
      }
      this.children.delete(configId);
    }
    try {
      await this.discover(configId, config, overlays);
    } catch (err) {
      console.error(`[grpc-connector] Failed to re-discover "${configId}":`, err);
    }
  }

  async teardown(): Promise<void> {
    for (const child of this.children.values()) {
      for (const client of child.clients.values()) {
        try { grpc.closeClient(client); } catch { /* ignore */ }
      }
    }
    this.children.clear();
  }

  async execute(tool: RegisteredTool, args: Record<string, unknown>): Promise<ConnectorResult> {
    const config = tool.connectorConfig as GrpcConnectorConfig;
    const child = this.children.get(tool.configId);

    if (!child) {
      return { success: false, data: { error: `gRPC config "${tool.configId}" not initialized` } };
    }

    const serviceName = tool.tool.service;
    const methodName = tool.tool.rpc_method;

    if (!serviceName || !methodName) {
      return { success: false, data: { error: "Tool missing service or rpc_method" } };
    }

    // Look up client by fq name or short name
    const client = child.clients.get(serviceName)
      ?? child.clients.get(serviceName.split(".").pop()!);

    if (!client) {
      return {
        success: false,
        data: { error: `No gRPC client found for service "${serviceName}"` },
      };
    }

    const metadata = buildMetadata(config.auth, tool.configId, config.metadata);
    const timeoutMs = config.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const deadline = new Date(Date.now() + timeoutMs);

    try {
      const result = await new Promise<unknown>((resolve, reject) => {
        (client as unknown as Record<string, Function>)[methodName](
          args,
          metadata,
          { deadline },
          (err: grpc.ServiceError | null, response: unknown) => {
            if (err) reject(err);
            else resolve(response);
          },
        );
      });

      return { success: true, data: result };
    } catch (err) {
      const svcErr = err as grpc.ServiceError;
      const code = svcErr.code !== undefined ? grpc.status[svcErr.code] : undefined;
      return {
        success: false,
        data: {
          error: svcErr.message,
          ...(code ? { grpcStatus: code } : {}),
        },
      };
    }
  }

  // ── Internal ────────────────────────────────────────────────────

  private async discover(
    configId: string,
    config: GrpcConnectorConfig,
    overlays?: Record<string, { description?: string }>,
  ): Promise<void> {
    let tools: ToolDef[];
    let clients: Map<string, grpc.Client>;

    if (config.proto_path) {
      ({ tools, clients } = await discoverFromProto(configId, config, overlays));
    } else if (config.reflection) {
      console.error(
        `[grpc-connector] "${configId}" server reflection not yet supported — add proto_path to config`,
      );
      tools = [];
      clients = new Map();
    } else {
      console.error(
        `[grpc-connector] "${configId}" requires proto_path or reflection:true`,
      );
      tools = [];
      clients = new Map();
    }

    this.children.set(configId, { configId, config, clients, tools });
  }
}
