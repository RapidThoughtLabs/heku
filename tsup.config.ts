import { defineConfig } from "tsup";
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  name: string;
  version: string;
};

// Node built-ins must stay external — CJS deps like dotenv do require("fs")
// which breaks when bundled into ESM. List both bare ("fs") and prefixed ("node:fs").
const nodeBuiltins = builtinModules.flatMap((m) => [m, `node:${m}`]);

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  outDir: "dist",
  clean: true,
  bundle: true,      // bundle all npm deps → single file, works with npx
  splitting: false,
  sourcemap: false,
  minify: false,
  shims: true,       // __dirname / __filename shims for ESM
  noExternal: [/(.*)/],   // bundle ALL npm packages
  external: nodeBuiltins, // keep Node built-ins external
  // Inject a createRequire shim so CJS packages bundled into ESM can still use require()
  banner: {
    js: `import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);`,
  },
  define: {
    __HEKU_VERSION__: JSON.stringify(pkg.version),
    __HEKU_NAME__: JSON.stringify(pkg.name),
  },
});
