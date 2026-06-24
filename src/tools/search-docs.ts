import { z } from "zod";
import { tool } from "./helpers";
import { searchDocs } from "../docs/fetch";

export const searchDocsTool = tool({
  description: [
    "Look up **Upstash Redis** documentation — any command, feature, option, or syntax.",
    "Covers the whole Upstash Redis surface: core Redis commands, the REST API, pipelines/transactions, and Upstash-specific features. This INCLUDES Upstash Redis Search — the SEARCH.* full-text family (SEARCH.CREATE / SEARCH.QUERY / SEARCH.AGGREGATE / SEARCH.COUNT / ...), whose JSON-based index schema and query syntax are Upstash-specific and DIFFER from Redis Labs' RediSearch FT.*, so they are unlikely to be in your training data — verify them here.",
    "Reach for this whenever you're unsure about a command, option, or syntax, and ALWAYS before writing a SEARCH.* command. Pass a natural-language query.",
  ].join("\n"),
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        'What to look up, in natural language, e.g. "SET with TTL and NX", "pipeline REST API", "ZADD options", "SEARCH.AGGREGATE date histogram", "define index schema".'
      ),
  }),
  handler: async ({ query }) => searchDocs(query),
});
