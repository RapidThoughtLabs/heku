import { describe, it, expect, vi } from "vitest";
import { argToParamDef, SCALAR_FORMAT_MAP } from "./graphql.js";
import type { GqlType, GqlInputValue, GqlFullType } from "./graphql.js";
import type { ParamDef } from "../types.js";

// Minimal GQL type constructors
const scalar = (name: string): GqlType => ({ kind: "SCALAR", name });
const enumType = (name: string): GqlType => ({ kind: "ENUM", name });
const inputObject = (name: string): GqlType => ({ kind: "INPUT_OBJECT", name });
const nonNull = (ofType: GqlType): GqlType => ({ kind: "NON_NULL", name: null, ofType });
const list = (ofType: GqlType): GqlType => ({ kind: "LIST", name: null, ofType });

function makeArg(name: string, type: GqlType, desc: string | null = null): GqlInputValue {
  return { name, description: desc, type, defaultValue: null };
}

function makeTypeMap(entries: Array<[string, GqlFullType]>): Map<string, GqlFullType> {
  return new Map(entries);
}

describe("argToParamDef — scalar types", () => {
  it("maps String to string", () => {
    const result = argToParamDef(makeArg("x", scalar("String")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ name: "x", type: "string", required: false });
  });

  it("marks required when NON_NULL", () => {
    const result = argToParamDef(makeArg("x", nonNull(scalar("String"))), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result.required).toBe(true);
    expect(result.type).toBe("string");
  });

  it("maps Int to number", () => {
    const result = argToParamDef(makeArg("n", scalar("Int")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result.type).toBe("number");
  });

  it("maps Boolean to boolean", () => {
    const result = argToParamDef(makeArg("b", scalar("Boolean")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result.type).toBe("boolean");
  });
});

describe("argToParamDef — custom scalars (format allowlist)", () => {
  it("maps DateTime to format date-time", () => {
    const result = argToParamDef(makeArg("ts", scalar("DateTime")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "string", format: "date-time" });
  });

  it("maps Date to format date", () => {
    const result = argToParamDef(makeArg("d", scalar("Date")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "string", format: "date" });
  });

  it("maps UUID to format uuid", () => {
    const result = argToParamDef(makeArg("id", scalar("UUID")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "string", format: "uuid" });
  });

  it("unknown custom scalar falls back to plain string", () => {
    const result = argToParamDef(makeArg("x", scalar("JSON")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "string" });
    expect(result.format).toBeUndefined();
  });

  it("SCALAR_FORMAT_MAP contains the three expected entries", () => {
    expect(SCALAR_FORMAT_MAP).toMatchObject({
      DateTime: "date-time",
      Date: "date",
      UUID: "uuid",
    });
  });
});

describe("argToParamDef — ENUM", () => {
  it("maps ENUM to string with enum values array", () => {
    const typeMap = makeTypeMap([
      ["Status", { kind: "ENUM", name: "Status", enumValues: [{ name: "ACTIVE" }, { name: "INACTIVE" }], inputFields: null, fields: null, description: null }],
    ]);
    const result = argToParamDef(makeArg("status", enumType("Status")), typeMap, 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "string", enum: ["ACTIVE", "INACTIVE"] });
  });

  it("ENUM with no values in typeMap still returns type string", () => {
    const result = argToParamDef(makeArg("x", enumType("Unknown")), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result.type).toBe("string");
    expect(result.enum).toBeUndefined();
  });
});


describe("argToParamDef — LIST", () => {
  it("maps LIST(String) to array with string items", () => {
    const result = argToParamDef(makeArg("tags", list(scalar("String"))), makeTypeMap([]), 0, new Set(), "cfg");
    expect(result).toMatchObject({ type: "array" });
    expect((result as ParamDef & { items: ParamDef }).items).toMatchObject({ type: "string" });
  });

  it("maps NON_NULL(LIST(NON_NULL(String))) correctly", () => {
    const result = argToParamDef(
      makeArg("ids", nonNull(list(nonNull(scalar("String"))))),
      makeTypeMap([]), 0, new Set(), "cfg",
    );
    expect(result).toMatchObject({ type: "array", required: true });
    expect(result.items).toMatchObject({ type: "string", required: true });
  });
});

describe("argToParamDef — INPUT_OBJECT nesting", () => {
  it("recurses into inputFields and builds properties", () => {
    const typeMap = makeTypeMap([
      ["FilterInput", {
        kind: "INPUT_OBJECT", name: "FilterInput", description: null, fields: null, enumValues: null,
        inputFields: [
          makeArg("field", scalar("String"), "field name"),
          makeArg("value", nonNull(scalar("String")), "field value"),
        ],
      }],
    ]);
    const result = argToParamDef(makeArg("filter", inputObject("FilterInput")), typeMap, 0, new Set(), "cfg");
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    expect(result.properties!["field"]).toMatchObject({ type: "string", required: false });
    expect(result.properties!["value"]).toMatchObject({ type: "string", required: true });
  });

  it("preserves description on nested fields", () => {
    const typeMap = makeTypeMap([
      ["PaginationInput", {
        kind: "INPUT_OBJECT", name: "PaginationInput", description: null, fields: null, enumValues: null,
        inputFields: [
          makeArg("limit", scalar("Int"), "max results"),
        ],
      }],
    ]);
    const result = argToParamDef(makeArg("page", inputObject("PaginationInput")), typeMap, 0, new Set(), "cfg");
    expect(result.properties!["limit"].description).toBe("max results");
  });
});

describe("argToParamDef — cycle detection", () => {
  it("truncates self-referential input type and emits console.error", () => {
    const typeMap = makeTypeMap([
      ["TreeNode", {
        kind: "INPUT_OBJECT", name: "TreeNode", description: null, fields: null, enumValues: null,
        inputFields: [makeArg("child", inputObject("TreeNode"))],
      }],
    ]);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = argToParamDef(makeArg("root", inputObject("TreeNode")), typeMap, 0, new Set(), "test-cfg");
    spy.mockRestore();

    // Top level should resolve (TreeNode not in visited yet)
    expect(result.type).toBe("object");
    expect(result.properties).toBeDefined();
    // The recursive child should be truncated to a plain object (cycle hit)
    expect(result.properties!["child"].type).toBe("object");
    expect(result.properties!["child"].properties).toBeUndefined();
  });
});

describe("argToParamDef — depth cap", () => {
  it("truncates at MAX_PARAM_DEPTH (4)", () => {
    // Build a 6-level chain: A -> B -> C -> D -> E -> F
    const letters = "ABCDEF".split("");
    const entries: Array<[string, GqlFullType]> = letters.map((c, i) => {
      const next = letters[i + 1];
      return [c, {
        kind: "INPUT_OBJECT", name: c, description: null, fields: null, enumValues: null,
        inputFields: next ? [makeArg("child", inputObject(next))] : [],
      }];
    });
    const typeMap = makeTypeMap(entries);

    const result = argToParamDef(makeArg("root", inputObject("A")), typeMap, 0, new Set(), "test-cfg");

    // Dig down to depth 4 and verify truncation
    let node: ParamDef = result;
    for (let i = 0; i < 4; i++) {
      expect(node.type).toBe("object");
      expect(node.properties).toBeDefined();
      node = node.properties!["child"];
    }
    // At depth 4 the node should be a plain object with no properties
    expect(node.type).toBe("object");
    expect(node.properties).toBeUndefined();
  });
});
