import readline from "node:readline";

// ── Plain text prompt ─────────────────────────────────────────────

/**
 * Ask the user a question and return their answer (trimmed).
 * Returns "" if the user presses Enter with no input.
 */
export function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });

    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      process.exit(1);
    });
  });
}

// ── Masked input ──────────────────────────────────────────────────

/**
 * Ask the user for a secret value. Characters are echoed as ● so the
 * user can see they're typing, but the actual value is not displayed.
 *
 * We write the prompt ourselves (bypassing readline's _writeToOutput) so
 * that readline's internal _refreshLine() calls can never re-mask the label.
 * Then we override _writeToOutput unconditionally: newlines pass through,
 * every other character → ●.
 */
export function askMasked(question: string): Promise<string> {
  return new Promise((resolve) => {
    // Print the prompt directly — keeps it off the _writeToOutput path entirely
    process.stdout.write(question);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    // Always mask ALL readline output: newlines pass through, everything else → ●
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (rl as any)._writeToOutput = function (str: string): void {
      if (str === "\r\n" || str === "\n" || str === "\r") {
        process.stdout.write(str);
      } else if (str.length > 0) {
        process.stdout.write("●".repeat(str.length));
      }
    };

    // Empty-string prompt — question is already on screen above
    rl.question("", (answer) => {
      rl.close();
      resolve(answer.trim());
    });

    rl.on("SIGINT", () => {
      process.stdout.write("\n");
      process.exit(1);
    });
  });
}

// ── Yes/No confirm ────────────────────────────────────────────────

/**
 * Ask a yes/no question. Returns true for "y" or "yes" (case-insensitive).
 * Any other input (including Enter alone) returns false.
 */
export function confirm(question: string): Promise<boolean> {
  return ask(question).then((answer) =>
    ["y", "yes"].includes(answer.toLowerCase()),
  );
}
