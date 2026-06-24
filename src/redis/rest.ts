import type { DatabaseConfig } from "../config";
import { config } from "../config";
import { telemetryHeaders } from "../telemetry";
import { log } from "../log";
import type { CommandResult } from "./types";

type RestReply = { result: unknown } | { error: string };

const MAX_RETRIES = 2;

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, init);
      // Retry on transient server errors only.
      if (res.status >= 500 && attempt < MAX_RETRIES) {
        await delay(attempt);
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        await delay(attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function delay(attempt: number): Promise<void> {
  const ms = Math.min(Math.exp(attempt) * 50, 1000);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalize(command: string[], reply: RestReply): CommandResult {
  return "error" in reply ? { command, error: reply.error } : { command, result: reply.result };
}

/**
 * Execute commands over the Upstash REST API.
 * - single command (non-transaction): POST to the base URL
 * - multiple commands: POST to /pipeline (independent) or /multi-exec (atomic)
 */
export async function runHttp(
  db: DatabaseConfig,
  commands: string[][],
  transaction: boolean
): Promise<CommandResult[]> {
  const base = (db.restUrl ?? "").replace(/\/+$/, "");
  const single = commands.length === 1 && !transaction;
  const path = single ? "" : transaction ? "/multi-exec" : "/pipeline";
  const body = single ? commands[0] : commands;

  log(`> REST ${db.name} ${path || "(single)"} x${commands.length}`);

  const res = await fetchWithRetry(base + path, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${db.restToken ?? ""}`,
      ...telemetryHeaders(config.disableTelemetry),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash REST request failed (HTTP ${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as RestReply | RestReply[];

  if (single) return [normalize(commands[0], data as RestReply)];

  // /multi-exec can return a single { error } object when the transaction is aborted.
  if (!Array.isArray(data)) {
    const error = "error" in data ? data.error : JSON.stringify(data);
    return commands.map((command) => ({ command, error: String(error) }));
  }

  return data.map((reply, i) => normalize(commands[i], reply));
}
