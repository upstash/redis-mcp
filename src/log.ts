// eslint-disable-next-line unicorn/prefer-node-protocol
import { appendFileSync } from "fs";
// eslint-disable-next-line unicorn/prefer-node-protocol
import path from "path";

let debugLogPath: string | null = null;
let debugEnabled = false;

export function initDebugLog(projectRoot: string) {
  debugEnabled = true;
  debugLogPath = path.resolve(projectRoot, "redis-mcp-debug.log");
}

/**
 * Debug logger. Writes to stderr (safe for stdio transport, which uses stdout
 * for the protocol) and, when --debug is set, to a log file as well.
 */
export function log(...args: unknown[]) {
  if (!debugEnabled) return;

  const msg = `[DEBUG ${new Date().toISOString()}] ${args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ")}\n`;

  process.stderr.write(msg);

  if (debugLogPath) {
    try {
      appendFileSync(debugLogPath, msg);
    } catch {
      // ignore file write errors
    }
  }
}
