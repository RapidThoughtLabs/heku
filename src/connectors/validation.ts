import { Ajv } from "ajv";
import type { ValidateFunction, ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import type { RegisteredTool } from "../types.js";
import { buildInputSchema } from "../lib/schema.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addFormatsAny = addFormats as unknown as (a: InstanceType<typeof Ajv>) => void;
const ajv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormatsAny(ajv);

const cache = new Map<string, ValidateFunction>();

export interface StructuredError {
  path: string;
  issue: string;
  expected?: string;
  got?: unknown;
}

export type ValidationResult = { valid: true } | { valid: false; errors: StructuredError[] };

function cacheKey(tool: RegisteredTool): string {
  return `${tool.configId}.${tool.tool.name}`;
}

function mapErrors(ajvErrors: ErrorObject[]): StructuredError[] {
  return ajvErrors.map((e) => {
    // AJV instancePath uses JSON Pointer notation (/a/b/c) — convert to dot notation
    const rawPath = e.instancePath.replace(/^\//, "").replace(/\//g, ".");
    const path = rawPath || "(root)";

    let issue = e.keyword;
    let expected: string | undefined;

    switch (e.keyword) {
      case "required":
        return {
          path: path === "(root)"
            ? (e.params as { missingProperty: string }).missingProperty
            : `${path}.${(e.params as { missingProperty: string }).missingProperty}`,
          issue: "missing_required",
        };
      case "type":
        expected = (e.params as { type: string }).type;
        issue = "wrong_type";
        break;
      case "format":
        expected = (e.params as { format: string }).format;
        issue = "invalid_format";
        break;
      case "enum":
        expected = JSON.stringify((e.params as { allowedValues: unknown[] }).allowedValues);
        issue = "invalid_enum";
        break;
      case "minimum":
      case "maximum":
      case "exclusiveMinimum":
      case "exclusiveMaximum":
        expected = `${e.keyword} ${(e.params as Record<string, unknown>).limit}`;
        issue = "out_of_range";
        break;
    }

    const entry: StructuredError = { path, issue };
    if (expected !== undefined) entry.expected = expected;

    // include the actual value for type/enum mismatches
    const got = e.data;
    if (got !== undefined && (issue === "wrong_type" || issue === "invalid_enum")) {
      entry.got = got;
    }

    return entry;
  });
}

export function validateArgs(
  tool: RegisteredTool,
  args: Record<string, unknown>,
): ValidationResult {
  const key = cacheKey(tool);
  let validate = cache.get(key);
  if (!validate) {
    validate = ajv.compile(buildInputSchema(tool.tool.params));
    cache.set(key, validate);
  }

  const valid = validate(args);
  if (valid) return { valid: true };

  return {
    valid: false,
    errors: mapErrors(validate.errors ?? []),
  };
}

export function invalidate(configId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${configId}.`)) {
      cache.delete(key);
    }
  }
}
