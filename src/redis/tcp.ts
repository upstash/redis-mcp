import { createClient } from "@redis/client";
import type { DatabaseConfig } from "../config";
import { log } from "../log";
import { type CommandResult, errorMessage } from "./types";

// node-redis v5's RedisClientType generics (RESP version, modules) don't unify
// cleanly through a Map, and we only ever call sendCommand / multi, so we keep
// the pooled client loosely typed.
type Client = any;

// One persistent, lazily-connected client per connection string, reused across
// tool calls for the lifetime of the process.
const pool = new Map<string, Client>();

async function getClient(db: DatabaseConfig): Promise<Client> {
  const key = db.connectionString ?? "";
  const existing = pool.get(key);
  if (existing) return existing;

  // `rediss://` in the connection string enables TLS automatically.
  const client = createClient({
    url: db.connectionString,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
    },
  });
  // Prevent unhandled 'error' events from crashing the process between calls.
  client.on("error", (err: unknown) => log("redis tcp error:", errorMessage(err)));
  await client.connect();
  pool.set(key, client);
  return client;
}

/**
 * Execute commands over the native RESP/TCP protocol using node-redis.
 * - pipeline: same-tick sendCommand calls are auto-pipelined; allSettled keeps
 *   per-command errors isolated.
 * - transaction: MULTI/EXEC (atomic).
 */
export async function runTcp(
  db: DatabaseConfig,
  commands: string[][],
  transaction: boolean
): Promise<CommandResult[]> {
  const client = await getClient(db);
  log(`> TCP ${db.name} ${transaction ? "multi" : "pipeline"} x${commands.length}`);

  if (transaction) {
    let multi = (client as any).multi();
    for (const command of commands) multi = multi.addCommand(command);
    try {
      const replies = (await multi.exec()) as unknown[];
      return commands.map((command, i) => ({ command, result: replies[i] }));
    } catch (error) {
      const message = errorMessage(error);
      return commands.map((command) => ({ command, error: message }));
    }
  }

  const settled = await Promise.allSettled(
    commands.map((command) => (client as any).sendCommand(command) as Promise<unknown>)
  );
  return settled.map((outcome, i) =>
    outcome.status === "fulfilled"
      ? { command: commands[i], result: outcome.value }
      : { command: commands[i], error: errorMessage(outcome.reason) }
  );
}

/** Close all pooled TCP connections (called on shutdown). */
export async function closeAllTcp(): Promise<void> {
  await Promise.allSettled([...pool.values()].map((client) => client.quit()));
  pool.clear();
}
