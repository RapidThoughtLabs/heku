/**
 * heku fork <namespace/slug>
 *
 * Forks a published config into the authenticated user's namespace.
 * Implemented via POST /publish with a cross-namespace target — the registry
 * detects that target.namespace != actor and handles it as a fork automatically.
 */

import { publish, fetchVersionPayload, getConfigMeta, RegistryError } from "../registry/client.js";
import { loadCredentials, getRegistry } from "../registry/auth.js";
import { bold, green, red, dim, cyan } from "../lib/fmt.js";

export async function run(args: string[]): Promise<void> {
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  const target = args.find((a) => !a.startsWith("--") && a !== args[registryFlag + 1]);

  if (!target) {
    console.error(red("✗") + ` Usage: ${bold("heku fork <namespace/slug>")}`);
    process.exit(1);
  }

  const parts = target.replace(/^@/, "").split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    console.error(
      red("✗") + ` Invalid target "${target}" — expected ${bold("<namespace/slug>")} (e.g. ${dim("ruchit/github")})`,
    );
    process.exit(1);
  }
  const [namespace, slug] = parts;

  const creds = loadCredentials(registryName);
  if (!creds) {
    console.error(
      red("✗") +
      ` Not logged in. Run: ${bold("heku login")}` +
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

  process.stdout.write("  Fetching source payload... ");

  let payload: unknown;
  let connectorType: string;
  try {
    const meta = await getConfigMeta(namespace, slug, undefined, registryName);
    connectorType = meta.connector_type;
    const vp = await fetchVersionPayload(namespace, slug, connectorType, undefined, registryName);
    payload = vp.payload;
    console.log(green("done"));
  } catch (err) {
    console.log(red("failed"));
    console.error(red("✗") + ` ${(err as Error).message}`);
    process.exit(1);
  }

  process.stdout.write("  Forking... ");

  try {
    const result = await publish({
      target: `@${namespace}/${slug}`,
      payload,
    }, registryName);

    console.log(green("done"));
    console.log();
    console.log(
      green("✓") +
      ` Forked ${bold(cyan(`${namespace}/${slug}`))} → ${bold(cyan(result.config.qualified_slug))}`,
    );
    const registryUrl = getRegistryUrlSafe(registryName);
    console.log(dim(`  ${registryUrl}/${result.config.namespace}/${result.config.slug}`));
    console.log();
    console.log(dim("  The fork starts at v1.0.0. Use `heku publish` to push changes."));
    console.log();

  } catch (err) {
    if (err instanceof RegistryError) {
      console.log(red("failed"));
      console.error(red("✗") + ` ${err.message}`);
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
