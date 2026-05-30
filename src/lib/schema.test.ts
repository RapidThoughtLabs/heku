import { describe, it, expect, vi } from "vitest";
import { schemaToParam, paramToSchema } from "./schema.js";

describe("schemaToParam — flat types", () => {
  it("parses a simple string param", () => {
    const p = schemaToParam("name", { type: "string", description: "user name" }, true);
    expect(p).toMatchObject({ name: "name", type: "string", required: true, description: "user name" });
  });

  it("parses number and boolean", () => {
    expect(schemaToParam("count", { type: "number" }, false).type).toBe("number");
    expect(schemaToParam("active", { type: "boolean" }, true).type).toBe("boolean");
  });

  it("unknown type falls back to string", () => {
    expect(schemaToParam("x", { type: "integer" }, false).type).toBe("string");
  });

  it("carries enum values", () => {
    const p = schemaToParam("status", { type: "string", enum: ["a", "b"] }, false);
    expect(p.enum).toEqual(["a", "b"]);
  });

  it("carries format", () => {
    const p = schemaToParam("ts", { type: "string", format: "date-time" }, false);
    expect(p.format).toBe("date-time");
  });

  it("carries default value", () => {
    const p = schemaToParam("limit", { type: "number", default: 10 }, false);
    expect(p.default).toBe(10);
  });
});

describe("schemaToParam — nested object", () => {
  it("recurses into properties", () => {
    const node = {
      type: "object",
      description: "address",
      required: ["line1"],
      properties: {
        line1: { type: "string", description: "street" },
        city: { type: "string", description: "city" },
      },
    };
    const p = schemaToParam("address", node, true);
    expect(p.type).toBe("object");
    expect(p.properties).toBeDefined();
    expect(p.properties!["line1"]).toMatchObject({ type: "string", required: true });
    expect(p.properties!["city"]).toMatchObject({ type: "string", required: false });
  });
});

describe("schemaToParam — array", () => {
  it("recurses into items", () => {
    const node = {
      type: "array",
      items: { type: "string", description: "tag" },
    };
    const p = schemaToParam("tags", node, false);
    expect(p.type).toBe("array");
    expect(p.items).toMatchObject({ type: "string" });
  });

  it("handles nested array-of-objects", () => {
    const node = {
      type: "array",
      items: {
        type: "object",
        properties: {
          Name: { type: "string", description: "filter name" },
          Values: { type: "array", items: { type: "string" } },
        },
        required: ["Name"],
      },
    };
    const p = schemaToParam("filters", node, false);
    expect(p.type).toBe("array");
    expect(p.items!.type).toBe("object");
    expect(p.items!.properties!["Name"]).toMatchObject({ required: true });
    expect(p.items!.properties!["Values"].type).toBe("array");
  });
});

describe("schemaToParam — depth cap", () => {
  it("truncates at depth 10 with console.error", () => {
    // Build 12-level nested object schema
    let node: Record<string, unknown> = { type: "string" };
    for (let i = 0; i < 12; i++) {
      node = { type: "object", properties: { child: node } };
    }

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = schemaToParam("root", node, false, 0, "test-cfg", "root");
    spy.mockRestore();

    // Dig to depth 10 — should be truncated
    let cur = result;
    for (let i = 0; i < 10; i++) {
      expect(cur.type).toBe("object");
      expect(cur.properties).toBeDefined();
      cur = cur.properties!["child"];
    }
    expect(cur.type).toBe("object");
    expect(cur.properties).toBeUndefined();
  });
});

describe("schemaToParam round-trip with paramToSchema", () => {
  it("round-trips a nested object", () => {
    const original = {
      type: "object",
      description: "payload",
      required: ["method"],
      properties: {
        method: { type: "string", enum: ["GET", "POST"], description: "HTTP method" },
        path: { type: "string", description: "URL path" },
      },
    };

    const param = schemaToParam("payload", original, true);
    const schema = paramToSchema(param);

    expect(schema.type).toBe("object");
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props["method"].enum).toEqual(["GET", "POST"]);
    expect(props["path"].type).toBe("string");
  });

  it("round-trips an array with items", () => {
    const original = {
      type: "array",
      items: { type: "string", format: "uuid", description: "id" },
    };

    const param = schemaToParam("ids", original, false);
    const schema = paramToSchema(param);

    expect(schema.type).toBe("array");
    expect((schema.items as Record<string, unknown>).format).toBe("uuid");
  });
});
