import { spawnSync } from "node:child_process";
import { fetchLatestVersion, semverGt } from "../lib/update-check.js";
import { VERSION, PKG_NAME } from "../lib/version.js";
import { bold, green, yellow, cyan } from "../lib/fmt.js";

export async function run(_args: string[]): Promise<void> {
  process.stderr.write(`  Checking for updates to ${bold(PKG_NAME)}...\n`);

  let latest: string;
  try {
    latest = await fetchLatestVersion();
  } catch {
    process.stderr.write(`  ${yellow("⚠")}  Could not reach npm registry. Check your network and try again.\n`);
    process.exit(1);
  }

  if (!semverGt(latest, VERSION)) {
    process.stderr.write(`  ${green("✓")}  Already up to date (${cyan(VERSION)})\n`);
    return;
  }

  process.stderr.write(`  ${bold(VERSION)} → ${bold(latest)}\n`);
  process.stderr.write(`  Running: npm install -g ${PKG_NAME}@latest\n\n`);

  const result = spawnSync("npm", ["install", "-g", `${PKG_NAME}@latest`], {
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    process.stderr.write(
      `\n  Update failed. You can update manually:\n    npm install -g ${PKG_NAME}@latest\n`,
    );
    process.exit(result.status ?? 1);
  }

  process.stderr.write(`\n  ${green("✓")}  Updated to ${bold(latest)}\n`);
}
