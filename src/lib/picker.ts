/**
 * Zero-dep numbered picker. Reuses readline-based ask() from prompt.ts.
 *
 * Returns the chosen option's value, or null when not running in a TTY —
 * callers should fall back to a non-interactive path on null (e.g. print
 * available options and exit non-zero).
 */

import { ask } from "./prompt.js";
import { bold, cyan, dim } from "./fmt.js";

export interface PickOption<T> {
  label: string;
  hint?: string;
  value: T;
}

export async function pick<T>(
  prompt: string,
  options: PickOption<T>[],
): Promise<T | null> {
  if (!process.stdin.isTTY) return null;
  if (options.length === 0) throw new Error("pick(): options must not be empty");
  if (options.length === 1) return options[0].value;

  console.log();
  console.log(`  ${bold(prompt)}`);
  for (let i = 0; i < options.length; i++) {
    const opt = options[i];
    const hint = opt.hint ? `  ${dim(opt.hint)}` : "";
    console.log(`    ${cyan(String(i + 1))}) ${opt.label}${hint}`);
  }
  console.log();

  while (true) {
    const answer = await ask(`  Pick [1-${options.length}]: `);
    const n = Number(answer);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      return options[n - 1].value;
    }
    console.log(
      `  ${dim(`Invalid selection — enter a number from 1 to ${options.length}`)}`,
    );
  }
}
