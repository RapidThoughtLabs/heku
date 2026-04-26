import { exec } from "node:child_process";
import {
  startOAuthListener,
  saveCredentials,
  clearCredentials,
  loadCredentials,
  isLoggedIn,
} from "../registry/auth.js";
import {
  exchangeAuthCode,
  buildOAuthUrl,
  apiLogout,
} from "../registry/client.js";
import { bold, green, red, dim, cyan } from "../lib/fmt.js";

function openBrowser(url: string): void {
  const cmd =
    process.platform === "darwin"
      ? `open "${url}"`
      : process.platform === "win32"
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

export async function run(args: string[]): Promise<void> {
  const sub = args[0];

  if (sub === "logout") {
    await runLogout(args.slice(1));
  } else {
    await runLogin(args);
  }
}

// ── login ─────────────────────────────────────────────────────────

async function runLogin(args: string[]): Promise<void> {
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  const codeFlag = args.indexOf("--code");
  const pastedCode = codeFlag !== -1 ? args[codeFlag + 1] : undefined;

  if (isLoggedIn(registryName)) {
    const creds = loadCredentials(registryName)!;
    console.log(
      green("✓") +
        ` Already logged in${creds.username ? ` as ${bold("@" + creds.username)}` : ""}. ` +
        dim("Run `mcp-one login logout` to switch accounts."),
    );
    return;
  }

  console.log();
  console.log(bold("  Logging in to app.rapidthoughtlabs.space"));
  console.log();

  let tokenRes;

  if (pastedCode) {
    // ── Paste-the-code flow (no browser required) ─────────────────
    process.stdout.write("  Exchanging auth code for tokens... ");
    try {
      tokenRes = await exchangeAuthCode(pastedCode, registryName);
    } catch (err) {
      console.log(red("failed"));
      console.error(red("✗") + " " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  } else {
    // ── Browser OAuth flow ────────────────────────────────────────
    const { port, state, result, close } = startOAuthListener();
    const redirectUri = `http://localhost:${port}/callback`;
    const loginUrl = buildOAuthUrl(port, state, registryName);

    console.log("  Opening browser for authentication...");
    console.log(dim(`  URL: ${loginUrl}`));
    console.log();

    openBrowser(loginUrl);

    console.log("  Waiting for browser callback" + dim(" (5 min timeout)") + "...");

    let callback: { code: string; state: string };
    try {
      callback = await result;
    } catch (err) {
      close();
      console.error(red("✗") + " " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }

    process.stdout.write("  Exchanging auth code for tokens... ");
    try {
      tokenRes = await exchangeAuthCode(callback.code, registryName, redirectUri);
    } catch (err) {
      console.log(red("failed"));
      console.error(red("✗") + " " + (err instanceof Error ? err.message : String(err)));
      process.exit(1);
    }
  }

  saveCredentials(
    {
      access_token:  tokenRes.access_token,
      refresh_token: tokenRes.refresh_token,
      username:      tokenRes.user.username,
    },
    registryName,
  );

  console.log(green("done"));
  console.log();
  console.log(
    green("✓") +
      ` Logged in as ${bold(cyan("@" + tokenRes.user.username))}` +
      (tokenRes.user.display_name ? ` (${tokenRes.user.display_name})` : ""),
  );
  console.log(
    dim(`  Credentials saved to ~/.mcp-one/credentials.json`),
  );
  console.log();
}

// ── logout ────────────────────────────────────────────────────────

async function runLogout(args: string[]): Promise<void> {
  const registryFlag = args.indexOf("--registry");
  const registryName = registryFlag !== -1 ? args[registryFlag + 1] : "default";

  if (!isLoggedIn(registryName)) {
    console.log(dim("  Not logged in."));
    return;
  }

  process.stdout.write("  Logging out... ");
  await apiLogout(registryName);
  clearCredentials(registryName);
  console.log(green("done"));
  console.log(green("✓") + " Logged out.");
}
