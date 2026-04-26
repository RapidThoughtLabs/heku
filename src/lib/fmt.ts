// ── ANSI Color Helpers ────────────────────────────────────────────
// TTY-aware: colors are stripped when stdout is not a terminal (e.g. piped).

const isTTY = process.stdout.isTTY === true;

function esc(open: string, close: string) {
  return (text: string): string =>
    isTTY ? `\x1b[${open}m${text}\x1b[${close}m` : text;
}

export const bold   = esc("1",  "22");
export const dim    = esc("2",  "22");
export const green  = esc("32", "39");
export const red    = esc("31", "39");
export const yellow = esc("33", "39");
export const cyan   = esc("36", "39");

// ── Strip ANSI helper (for width measurement) ─────────────────────

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function visibleLength(str: string): number {
  return str.replace(ANSI_RE, "").length;
}

function padRight(str: string, width: number): string {
  const pad = width - visibleLength(str);
  return pad > 0 ? str + " ".repeat(pad) : str;
}

// ── ASCII Table Renderer ──────────────────────────────────────────

export interface Column {
  header: string;
  key: string;
}

/**
 * Renders an ASCII table with Unicode box-drawing characters.
 * Handles ANSI color codes correctly when calculating column widths.
 *
 * @example
 * table(
 *   [{ header: "ID", key: "id" }, { header: "Status", key: "status" }],
 *   [{ id: "github", status: green("✅ configured") }],
 * )
 */
export function table(
  columns: Column[],
  rows: Record<string, string>[],
): string {
  // Calculate column widths: max of header length and all cell values
  const widths = columns.map((col) => {
    let max = visibleLength(col.header);
    for (const row of rows) {
      const cell = row[col.key] ?? "";
      max = Math.max(max, visibleLength(cell));
    }
    return max;
  });

  // Box-drawing helpers
  const border = (l: string, m: string, r: string, fill: string) =>
    l + widths.map((w) => fill.repeat(w + 2)).join(m) + r;

  const row = (cells: string[]) =>
    "│" +
    cells
      .map((cell, i) => ` ${padRight(cell, widths[i])} `)
      .join("│") +
    "│";

  const top    = border("┌", "┬", "┐", "─");
  const sep    = border("├", "┼", "┤", "─");
  const bottom = border("└", "┴", "┘", "─");

  const headerCells = columns.map((col) => bold(col.header));
  const dataRows = rows.map((r) =>
    row(columns.map((col) => r[col.key] ?? "")),
  );

  return [top, row(headerCells), sep, ...dataRows, bottom].join("\n");
}
