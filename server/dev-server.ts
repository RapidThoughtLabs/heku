// Standalone bridge entry for local development (npm run dev:server).
// Not imported by the CLI — src/commands/start.ts imports startBridge directly
// from ./index.js and only calls it when --http is passed. Keeping this runner
// in its own file (rather than a conditional at the bottom of index.ts) means
// importing index.ts can never have the side effect of starting a server —
// that used to rely on an `isMain` check that broke once tsup bundled index.ts
// into the same file as the CLI, so it started the bridge on every command.
import { startBridge } from "./index.js";

const port = Number(process.env["PORT"] ?? 3456);
const bridge = await startBridge({ port });

async function shutdown(signal: string): Promise<void> {
  console.error(`\n[bridge] ${signal} received — shutting down`);
  await bridge.shutdown();
  process.exit(0);
}

process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
process.once("SIGINT",  () => { void shutdown("SIGINT");  });
process.on("unhandledRejection", (err) => {
  console.error("[bridge] Unhandled rejection (non-fatal):", err);
});
