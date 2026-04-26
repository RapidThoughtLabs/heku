/**
 * mcp-one fork <namespace/slug>
 *
 * Forks a published config from the registry into the authenticated user's namespace.
 *
 * The server:
 *   - Creates a new configs row under <you>/<slug> with forked_from set
 *   - Copies the source's latest published payload verbatim as v1.0.0
 *   - Notifies the original author
 *
 * Returns 409 if <you>/<slug> already exists, or if the source has no published versions.
 */

import { forkConfig, RegistryError } from "../registry/client.js";
import { loadCredentials, getRegistry } from "../registry/auth.js";
import { bold, green, red, dim, cyan } from "../lib/fmt.js";

export async function run(args: string[]): Promise<void> {
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  // Find the <namespace/slug> argument (first non-flag arg)
  const target = args.find((a) => !a.startsWith("--") && a !== args[registryFlag + 1]);

  if (!target) {
    console.error(red("✗") + ` Usage: ${bold("mcp-one fork <namespace/slug>")}`);
    process.exit(1);
  }

  // Parse namespace/slug
  const parts = target.replace(/^@/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(
      red("✗") + ` Invalid target "${target}" — expected ${bold("<namespace/slug>")} (e.g. ${dim("ruchit/github")})`,
    );
    process.exit(1);
  }
  const [namespace, slug] = parts;

  // Auth check
  const creds = loadCredentials(registryName);
  if (!creds) {
    console.error(
      red("✗") +
      ` Not logged in. Run: ${bold("mcp-one login")}` +
      (registryName !== "default" ? ` --registry ${registryName}` : ""),
    );
    process.exit(1);
  }

  console.log();
  console.log(bold("  Forking config"));
  console.log();
  console.log(`  Source: ${bold(cyan(`${namespace}/${slug}`))}`);
  console.log(`  Into:   ${bold(cyan(`${creds.username ?? "<you>"}/${slug}`))}`);
  console.log();

  process.stdout.write("  Forking... ");

  try {
    const result = await forkConfig(namespace, slug, registryName);

    console.log(green("done"));
    console.log();
    console.log(
      green("✓") +
      ` Forked ${bold(cyan(`${namespace}/${slug}`))} → ${bold(cyan(`${result.namespace}/${result.slug}`))}`,
    );
    const registryUrl = getRegistryUrlSafe(registryName);
    console.log(dim(`  ${registryUrl}/${result.namespace}/${result.slug}`));
    console.log();
    console.log(dim("  The fork starts at v1.0.0. Use `mcp-one publish` to push changes."));
    console.log();

  } catch (err) {
    if (err instanceof RegistryError) {
      console.log(red("failed"));
      if (err.status === 409) {
        console.error(
          red("✗") +
          ` ${err.message || `"${creds.username}/${slug}" already exists in the registry.`}`,
        );
      } else {
        console.error(red("✗") + ` ${err.message}`);
      }
    } else {
      console.log(red("failed"));
      console.error(red("✗") + ` ${(err as Error).message}`);
    }
    process.exit(1);
  }
}

function getRegistryUrlSafe(registryName: string): string {
  try {
    return getRegistry(registryName).url;
  } catch {
    return "https://mcp.rapidthoughtlabs.space";
  }
}
