import { z, type ZodSchema } from "zod";
import { json, tool } from "./helpers";
import { type CredentialInput, config, databaseNames, resolveDatabase } from "../config";
import { execute } from "../redis/execute";
import { log } from "../log";

function description(names: string[]): string {
  const lines = [
    "Run one or more Redis commands against an Upstash Redis database (this server is ONLY for Upstash Redis).",
    "Commands are sent over HTTP/REST or native TCP depending on how the target database is configured — you don't choose the transport.",
    "By default multiple commands run as a pipeline: each returns its own result/error, and one failure does not abort the others.",
    "Set transaction:true to run them atomically (MULTI/EXEC).",
    "For discovery prefer SCAN over KEYS, and use TYPE to inspect a key.",
    "A valid command that fails (e.g. WRONGTYPE) returns a per-command error while the rest of the pipeline still runs; a malformed/unknown command can cause the whole request to be rejected.",
    'Upstash Redis Search runs through THIS tool via SEARCH.* commands (SEARCH.LISTINDEXES/CREATE/QUERY/AGGREGATE/COUNT/DESCRIBE) — NOT RediSearch\'s FT.*; filters/aggregations are JSON strings. If you don\'t know the index name, run SEARCH.LISTINDEXES first; then SEARCH.DESCRIBE <index> for field names/types, and call redis_search_docs for syntax. Three gotchas: (1) a filter applies to ALL indexed documents unless you scope it, e.g. {"type":"story"} — an empty {} counts every type; (2) a plain text value like {"title":"x"} does fuzzy/smart matching, so for an exact word or adjacent phrase use {"title":{"$phrase":"x"}}; (3) add SELECT <n> field... to a query to return only the fields you need instead of whole documents.',
  ];
  if (names.length > 1) {
    lines.push(`Configured databases: ${names.join(", ")}. Set "database" to choose one.`);
  }
  return lines.join("\n");
}

export function buildRunCommandsTool() {
  const names = databaseNames();
  const multipleDatabases = names.length > 1;

  const base = {
    commands: z
      .array(z.array(z.union([z.string(), z.number()]).transform(String)).min(1))
      .min(1)
      .describe(
        'Redis commands; each is an array of args. Single: [["SET","foo","bar"]]. ' +
          'Multiple: [["SET","foo","bar"],["GET","foo"]]. Numbers are accepted and coerced to ' +
          'strings, so ["EXPIRE","k",60], ["ZADD","z",80,"bob"] and Lua numkeys ["EVAL",script,1,key] all work.'
      ),
    transaction: z
      .boolean()
      .optional()
      .describe(
        "Run all commands in one MULTI/EXEC transaction (queued, executed together, no interleaving). " +
          "Like standard Redis, a runtime error in one command does NOT roll back the others. Default false (pipeline)."
      ),
    rest_url: z
      .string()
      .optional()
      .describe("Raw HTTP credential override: Upstash REST URL (must be paired with rest_token)."),
    rest_token: z
      .string()
      .optional()
      .describe("Raw HTTP credential override: Upstash REST token (must be paired with rest_url)."),
    connection_string: z
      .string()
      .optional()
      .describe("Raw TCP credential override: rediss:// connection string."),
  };

  // The `database` selector only exists when more than one database is configured.
  const inputSchema: ZodSchema = multipleDatabases
    ? z.object({
        ...base,
        database: z
          .enum(names as [string, ...string[]])
          .optional()
          .describe(`Which configured database to target. One of: ${names.join(", ")}.`),
      })
    : z.object(base);

  return tool({
    description: description(names),
    inputSchema,
    handler: async (input) => {
      const params = input as CredentialInput & { commands: string[][]; transaction?: boolean };
      const db = resolveDatabase(params);
      log("run_commands ->", db.name, db.transport, `x${params.commands.length}`);
      const results = await execute(db, params.commands, params.transaction ?? false);
      return json({
        database: db.name,
        transport: db.transport,
        readonly: config.readonly || undefined,
        results,
      });
    },
  });
}
