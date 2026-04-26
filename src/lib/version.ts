// Build-time constants set by tsup define (see tsup.config.ts).
// Fall back to dev placeholders when running via tsx without a build step.
export const VERSION: string =
  typeof __MCPONE_VERSION__ !== "undefined" ? __MCPONE_VERSION__ : "0.0.0-dev";

export const PKG_NAME: string =
  typeof __MCPONE_NAME__ !== "undefined" ? __MCPONE_NAME__ : "mcp-one";
