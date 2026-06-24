/** Base URL for Upstash documentation (used as a fallback by the docs tool). */
export const UPSTASH_DOCS_BASE_URL = "https://upstash.com/docs";

/**
 * Context7 powers `redis_search_docs`. We hit the free, unauthenticated public
 * endpoint (no API key) and pin it to the Upstash Redis docs library, which
 * covers the full Upstash Redis surface — core commands, the REST API, and the
 * Upstash-specific `SEARCH.*` full-text family.
 */
export const CONTEXT7_CONTEXT_URL = "https://context7.com/api/v2/context";
export const CONTEXT7_LIBRARY_ID = "/websites/upstash_redis";
