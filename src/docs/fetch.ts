import { CONTEXT7_CONTEXT_URL, CONTEXT7_LIBRARY_ID, UPSTASH_DOCS_BASE_URL } from "../settings";
import { log } from "../log";

// Responses are deterministic per query and the docs change rarely, so cache
// for the lifetime of the process to avoid re-hitting Context7 on repeats.
const cache = new Map<string, string>();

function buildHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "User-Agent": "upstash-redis-mcp" };
  // Optional: lift the free-tier rate limit by authenticating. Off by default.
  const apiKey = process.env.CONTEXT7_API_KEY?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function buildUrl(query: string): string {
  const url = new URL(CONTEXT7_CONTEXT_URL);
  url.searchParams.set("libraryId", CONTEXT7_LIBRARY_ID);
  url.searchParams.set("query", query);
  // Plain-text format returns ready-to-read markdown snippets; the JSON form
  // would need reassembling. We keep LLM reranking on (no `fast`) for relevance.
  url.searchParams.set("type", "txt");
  return url.toString();
}

/**
 * Context7 prepends a "LIBRARY RULES" block from the Upstash maintainers — it
 * includes a note nudging AI agents to POST to start-redis for a throwaway DB.
 * That would derail an agent already pointed at a configured database, so drop
 * the preamble and keep only the documentation snippets (each a `### ` heading).
 */
function stripPreamble(text: string): string {
  if (!text.slice(0, 400).includes("LIBRARY RULES")) return text;
  const idx = text.indexOf("\n### ");
  return idx === -1 ? text : text.slice(idx + 1).trim();
}

function fallbackMessage(query: string, reason: unknown): string {
  const why = reason instanceof Error ? reason.message : String(reason);
  return [
    `Could not fetch Upstash Redis docs for "${query}" (${why}).`,
    `Browse the docs directly at ${UPSTASH_DOCS_BASE_URL}/redis, or retry shortly.`,
  ].join("\n\n");
}

/**
 * Look up Upstash Redis documentation for a natural-language query via the
 * Context7 public API. Covers the whole Upstash Redis surface — core commands,
 * the REST API, and the Upstash-specific `SEARCH.*` family. Returns a graceful
 * message pointing at the live docs if the lookup fails.
 */
export async function searchDocs(query: string): Promise<string> {
  const trimmed = query.trim();
  if (!trimmed) return `Pass a non-empty query, e.g. "SET with TTL" or "SEARCH.QUERY syntax".`;

  const cached = cache.get(trimmed);
  if (cached) return cached;

  let res: Response;
  try {
    res = await fetch(buildUrl(trimmed), { headers: buildHeaders() });
  } catch (error) {
    log("docs fetch failed:", error);
    return fallbackMessage(trimmed, error);
  }

  if (!res.ok) {
    const reason =
      res.status === 429
        ? new Error("rate limited by Context7 — wait a moment and retry")
        : new Error(`Context7 HTTP ${res.status} ${res.statusText}`.trim());
    log("docs fetch non-OK:", reason);
    return fallbackMessage(trimmed, reason);
  }

  const text = await res.text();
  const body = stripPreamble(text.trim());
  if (!body) {
    return [
      `No Upstash Redis docs matched "${trimmed}".`,
      `Try a different phrasing, or browse ${UPSTASH_DOCS_BASE_URL}/redis.`,
    ].join("\n\n");
  }

  const result = `Upstash Redis docs for "${trimmed}":\n\n${body}`;
  cache.set(trimmed, result);
  return result;
}
