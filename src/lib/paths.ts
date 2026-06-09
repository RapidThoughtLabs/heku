import os from "node:os";
import path from "node:path";

export function stateDir(): string {
  return process.env.HEKU_STATE_DIR ?? path.join(os.homedir(), ".heku", "state");
}

export function installSentinelDir(): string {
  return path.join(stateDir(), "installs");
}
