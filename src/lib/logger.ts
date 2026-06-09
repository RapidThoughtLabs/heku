/**
 * Structured logging for heku
 *
 * Three output channels:
 *  1. Console (stderr) — default shows info+warn+error; --debug shows all
 *  2. File (JSONL)     — always writes everything to ~/.heku/logs/session-<ts>.jsonl
 *  3. In-memory ring   — last N entries for the /api/logs endpoint to poll
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CallerContext } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface ToolCallMeta {
  tool: string;
  configId: string;
  requestId?: string;
  caller?: string;
  callerCtx?: CallerContext;
  args?: Record<string, unknown>;
  duration_ms?: number;
  success?: boolean;
  error?: string;
}

// ── Constants ────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABEL: Record<LogLevel, string> = {
  debug: "\x1b[90mDEBUG\x1b[0m",  // dim
  info:  "\x1b[36m INFO\x1b[0m",   // cyan
  warn:  "\x1b[33m WARN\x1b[0m",   // yellow
  error: "\x1b[31mERROR\x1b[0m",   // red
};

const RING_BUFFER_SIZE = 5000;
const MAX_SESSION_FILES = 20;
const LOGS_DIR = path.join(os.homedir(), ".heku", "logs");

// ── Logger class ─────────────────────────────────────────────────────

class Logger {
  private consoleLevel: LogLevel = "info";
  private ring: LogEntry[] = [];
  private logStream: fs.WriteStream | null = null;
  private sessionId: string = "";
  private initialized = false;

  /** Call once at startup. Opens the session log file. */
  init(options: { debug?: boolean } = {}): void {
    if (this.initialized) return;
    this.initialized = true;

    if (options.debug) {
      this.consoleLevel = "debug";
    }

    // Ensure logs directory exists
    fs.mkdirSync(LOGS_DIR, { recursive: true });

    // Clean up old session files (keep last MAX_SESSION_FILES)
    this.cleanOldSessions();

    // Create session log file
    const now = new Date();
    this.sessionId = `session-${now.toISOString().replace(/[:.]/g, "-")}`;
    const logPath = path.join(LOGS_DIR, `${this.sessionId}.jsonl`);
    this.logStream = fs.createWriteStream(logPath, { flags: "a" });
  }

  /** Set console verbosity level */
  setConsoleLevel(level: LogLevel): void {
    this.consoleLevel = level;
  }

  /** Current session ID */
  getSessionId(): string {
    return this.sessionId;
  }

  // ── Core log methods ───────────────────────────────────────────────

  debug(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("debug", category, message, metadata);
  }

  info(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("info", category, message, metadata);
  }

  warn(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", category, message, metadata);
  }

  error(category: string, message: string, metadata?: Record<string, unknown>): void {
    this.log("error", category, message, metadata);
  }

  // ── Specialized log helpers ────────────────────────────────────────

  /** Log a tool call start (debug level) */
  toolCallStart(meta: ToolCallMeta): void {
    const reqTag = meta.requestId ? `[${meta.requestId.slice(0, 8)}] ` : "";
    this.debug("call", `${reqTag}→ ${meta.tool}`, {
      requestId: meta.requestId,
      tool: meta.tool,
      configId: meta.configId,
      caller: meta.caller,
      callerCtx: meta.callerCtx,
      args: meta.args,
    });
  }

  /** Log a tool call result */
  toolCallEnd(meta: ToolCallMeta): void {
    const level = meta.success ? "debug" : "warn";
    const icon = meta.success ? "✅" : "❌";
    const timing = meta.duration_ms !== undefined ? ` (${meta.duration_ms}ms)` : "";
    const errSuffix = meta.error ? ` — ${meta.error}` : "";
    const reqTag = meta.requestId ? `[${meta.requestId.slice(0, 8)}] ` : "";
    this.log(level, "call", `${reqTag}${icon} ${meta.tool}${timing}${errSuffix}`, {
      requestId: meta.requestId,
      tool: meta.tool,
      configId: meta.configId,
      caller: meta.caller,
      callerCtx: meta.callerCtx,
      duration_ms: meta.duration_ms,
      success: meta.success,
      ...(meta.error ? { error: meta.error } : {}),
    });
  }

  // ── Ring buffer access (for API) ───────────────────────────────────

  /**
   * Get log entries since a timestamp.
   * If no timestamp, returns the last `limit` entries.
   */
  getEntries(options: {
    since?: string;
    level?: LogLevel;
    category?: string;
    limit?: number;
  } = {}): LogEntry[] {
    let entries = this.ring;

    if (options.since) {
      const sinceTime = new Date(options.since).getTime();
      entries = entries.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
    }

    if (options.level) {
      const minPriority = LEVEL_PRIORITY[options.level];
      entries = entries.filter((e) => LEVEL_PRIORITY[e.level] >= minPriority);
    }

    if (options.category) {
      entries = entries.filter((e) => e.category === options.category);
    }

    const limit = options.limit ?? 200;
    if (entries.length > limit) {
      entries = entries.slice(entries.length - limit);
    }

    return entries;
  }

  /** List available session log files */
  listSessions(): Array<{ id: string; path: string; size: number; created: string }> {
    try {
      const files = fs.readdirSync(LOGS_DIR)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .reverse();

      return files.map((f) => {
        const fullPath = path.join(LOGS_DIR, f);
        const stat = fs.statSync(fullPath);
        return {
          id: f.replace(".jsonl", ""),
          path: fullPath,
          size: stat.size,
          created: stat.birthtime.toISOString(),
        };
      });
    } catch {
      return [];
    }
  }

  /** Read entries from a specific session file */
  readSession(sessionId: string, options: { limit?: number; since?: string } = {}): LogEntry[] {
    const filePath = path.join(LOGS_DIR, `${sessionId}.jsonl`);
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      let entries: LogEntry[] = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as LogEntry);

      if (options.since) {
        const sinceTime = new Date(options.since).getTime();
        entries = entries.filter((e) => new Date(e.timestamp).getTime() > sinceTime);
      }

      const limit = options.limit ?? 500;
      if (entries.length > limit) {
        entries = entries.slice(entries.length - limit);
      }

      return entries;
    } catch {
      return [];
    }
  }

  /** Flush and close the log stream */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  // ── Passthrough for banner/formatted output ────────────────────────
  // Some output (startup banner, tables) should always go to stderr
  // without structured logging.

  /** Write raw text to stderr — for banners, tables, formatted CLI output */
  raw(text: string): void {
    process.stderr.write(text + "\n");
  }

  // ── Internal ───────────────────────────────────────────────────────

  private log(
    level: LogLevel,
    category: string,
    message: string,
    metadata?: Record<string, unknown>,
  ): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {}),
    };

    // 1. Ring buffer — always
    this.ring.push(entry);
    if (this.ring.length > RING_BUFFER_SIZE) {
      this.ring.splice(0, this.ring.length - RING_BUFFER_SIZE);
    }

    // 2. File — always (if initialized)
    if (this.logStream) {
      this.logStream.write(JSON.stringify(entry) + "\n");
    }

    // 3. Console — respect level threshold
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.consoleLevel]) {
      const label = LEVEL_LABEL[level];
      const cat = `\x1b[90m[${category}]\x1b[0m`;
      process.stderr.write(`${label} ${cat} ${message}\n`);
    }
  }

  private cleanOldSessions(): void {
    try {
      const files = fs.readdirSync(LOGS_DIR)
        .filter((f) => f.endsWith(".jsonl"))
        .sort();

      if (files.length >= MAX_SESSION_FILES) {
        const toDelete = files.slice(0, files.length - MAX_SESSION_FILES + 1);
        for (const f of toDelete) {
          fs.unlinkSync(path.join(LOGS_DIR, f));
        }
      }
    } catch {
      // ignore cleanup errors
    }
  }
}

// ── Singleton export ─────────────────────────────────────────────────

export const log = new Logger();
