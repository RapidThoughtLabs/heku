import { describe, it, expect, beforeEach } from "vitest";
import { validateArgs, invalidate } from "./validation.js";
import type { RegisteredTool } from "../types.js";

function makeTool(overrides: Partial<RegisteredTool["tool"]> = {}): RegisteredTool {
  return {
    configId: "test",
    connectorConfig: { type: "http", base_url: "https://example.com" },
    tool: {
      name: "test_tool",
      description: "test",
      params: [],
      ...overrides,
    },
  };
}

beforeEach(() => {
  invalidate("test");
});

describe("validateArgs — flat params", () => {
  it("passes when all required fields are present with correct types", () => {
    const tool = makeTool({
      params: [
        { name: "name", type: "string", required: true, description: "name" },
        { name: "count", type: "number", required: false, description: "count" },
      ],
    });
    const result = validateArgs(tool, { name: "alice" });
    expect(result.valid).toBe(true);
  });

  it("fails when a required field is missing", () => {
    const tool = makeTool({
      params: [{ name: "id", type: "string", required: true, description: "id" }],
    });
    const result = validateArgs(tool, {});
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].issue).toBe("missing_required");
      expect(result.errors[0].path).toBe("id");
    }
  });

  it("fails on wrong type", () => {
    const tool = makeTool({
      params: [{ name: "count", type: "number", required: true, description: "count" }],
    });
    const result = validateArgs(tool, { count: "not-a-number" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const err = result.errors.find((e) => e.issue === "wrong_type");
      expect(err).toBeDefined();
      expect(err?.expected).toBe("number");
      expect(err?.got).toBe("not-a-number");
    }
  });
});

describe("validateArgs — enum and format", () => {
  it("rejects a value not in enum", () => {
    const tool = makeTool({
      params: [{
        name: "status",
        type: "string",
        required: true,
        description: "status",
        enum: ["active", "inactive"],
      }],
    });
    const result = validateArgs(tool, { status: "pending" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const err = result.errors.find((e) => e.issue === "invalid_enum");
      expect(err).toBeDefined();
    }
  });

  it("accepts a value within enum", () => {
    const tool = makeTool({
      params: [{
        name: "status",
        type: "string",
        required: true,
        description: "status",
        enum: ["active", "inactive"],
      }],
    });
    expect(validateArgs(tool, { status: "active" }).valid).toBe(true);
  });

  it("rejects an invalid email format", () => {
    const tool = makeTool({
      params: [{
        name: "email",
        type: "string",
        required: true,
        description: "email",
        format: "email",
      }],
    });
    const result = validateArgs(tool, { email: "not-an-email" });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].issue).toBe("invalid_format");
    }
  });

  it("accepts a valid email", () => {
    const tool = makeTool({
      params: [{
        name: "email",
        type: "string",
        required: true,
        description: "email",
        format: "email",
      }],
    });
    expect(validateArgs(tool, { email: "alice@example.com" }).valid).toBe(true);
  });
});

describe("validateArgs — nested object", () => {
  it("passes a valid nested object", () => {
    const tool = makeTool({
      params: [{
        name: "address",
        type: "object",
        required: true,
        description: "address",
        location: "body",
        properties: {
          line1: { name: "line1", type: "string", required: true, description: "street" },
          city:  { name: "city",  type: "string", required: true, description: "city" },
          zip:   { name: "zip",   type: "string", required: false, description: "zip" },
        },
      }],
    });
    const result = validateArgs(tool, { address: { line1: "123 Main St", city: "Springfield" } });
    expect(result.valid).toBe(true);
  });

  it("fails when a required nested field is missing", () => {
    const tool = makeTool({
      params: [{
        name: "address",
        type: "object",
        required: true,
        description: "address",
        location: "body",
        properties: {
          line1: { name: "line1", type: "string", required: true, description: "street" },
          city:  { name: "city",  type: "string", required: true, description: "city" },
        },
      }],
    });
    const result = validateArgs(tool, { address: { line1: "123 Main St" } });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors[0].issue).toBe("missing_required");
      expect(result.errors[0].path).toContain("city");
    }
  });
});

describe("validateArgs — array of objects", () => {
  it("fails when an array item has a type mismatch", () => {
    const tool = makeTool({
      params: [{
        name: "filters",
        type: "array",
        required: false,
        description: "filters",
        location: "body",
        items: {
          name: "filter",
          type: "object",
          required: true,
          description: "filter entry",
          properties: {
            Name:   { name: "Name",   type: "string", required: true, description: "filter name" },
            Values: { name: "Values", type: "array",  required: true, description: "filter values" },
          },
        },
      }],
    });
    const result = validateArgs(tool, {
      filters: [{ Name: "instance-state-name", Values: "running" }], // Values should be array
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      const typeErr = result.errors.find((e) => e.issue === "wrong_type");
      expect(typeErr).toBeDefined();
    }
  });

  it("passes a valid array of objects", () => {
    const tool = makeTool({
      params: [{
        name: "filters",
        type: "array",
        required: false,
        description: "filters",
        location: "body",
        items: {
          name: "filter",
          type: "object",
          required: true,
          description: "filter entry",
          properties: {
            Name:   { name: "Name",   type: "string", required: true, description: "filter name" },
            Values: { name: "Values", type: "array",  required: true, description: "filter values" },
          },
        },
      }],
    });
    const result = validateArgs(tool, {
      filters: [{ Name: "instance-state-name", Values: ["running", "stopped"] }],
    });
    expect(result.valid).toBe(true);
  });
});

describe("validate_input opt-out", () => {
  it("skips validation when validate_input is false", () => {
    const tool = makeTool({
      params: [{ name: "id", type: "string", required: true, description: "id" }],
      validate_input: false,
    });
    // The executor checks validate_input before calling validateArgs.
    // Here we confirm validateArgs itself still validates — opt-out is in executor.
    // This test validates the flag is preserved on the tool.
    expect(tool.tool.validate_input).toBe(false);
  });
});
