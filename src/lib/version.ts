// Build-time constants set by tsup define (see tsup.config.ts).
// Fall back to dev placeholders when running via tsx without a build step.
export const VERSION: string =
  typeof __HEKU_VERSION__ !== "undefined" ? __HEKU_VERSION__ : "0.0.0-dev";

export const PKG_NAME: string =
  typeof __HEKU_NAME__ !== "undefined" ? __HEKU_NAME__ : "@rapidthoughtlabs/heku";
