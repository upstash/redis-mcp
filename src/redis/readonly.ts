/**
 * Best-effort allowlist of read-only Redis commands. Used by the optional
 * --readonly / UPSTASH_REDIS_READONLY guard. This is intentionally
 * conservative: anything not clearly read-only (EVAL, FUNCTION, FCALL, SORT
 * with STORE, etc.) is treated as a write and rejected. Server-side read-only
 * REST tokens remain the robust mechanism; this is a convenience guard that
 * also covers the TCP path.
 */
const READ_ONLY_COMMANDS = new Set<string>([
  // connection / server (safe, informational)
  "PING",
  "ECHO",
  "TIME",
  "INFO",
  "DBSIZE",
  "LOLWUT",
  "WAIT",
  "EXISTS",
  "TYPE",
  "TTL",
  "PTTL",
  "EXPIRETIME",
  "PEXPIRETIME",
  "KEYS",
  "SCAN",
  "RANDOMKEY",
  "TOUCH",
  "DUMP",
  "OBJECT",
  "MEMORY",
  "LCS",
  // strings
  "GET",
  "GETRANGE",
  "SUBSTR",
  "MGET",
  "STRLEN",
  "BITCOUNT",
  "BITPOS",
  "GETBIT",
  // hashes
  "HGET",
  "HMGET",
  "HGETALL",
  "HKEYS",
  "HVALS",
  "HLEN",
  "HEXISTS",
  "HSCAN",
  "HSTRLEN",
  "HRANDFIELD",
  // lists
  "LRANGE",
  "LLEN",
  "LINDEX",
  "LPOS",
  // sets
  "SMEMBERS",
  "SISMEMBER",
  "SMISMEMBER",
  "SCARD",
  "SRANDMEMBER",
  "SSCAN",
  "SINTER",
  "SUNION",
  "SDIFF",
  "SINTERCARD",
  // sorted sets
  "ZRANGE",
  "ZRANGEBYSCORE",
  "ZRANGEBYLEX",
  "ZREVRANGE",
  "ZREVRANGEBYSCORE",
  "ZREVRANGEBYLEX",
  "ZRANK",
  "ZREVRANK",
  "ZSCORE",
  "ZMSCORE",
  "ZCARD",
  "ZCOUNT",
  "ZLEXCOUNT",
  "ZSCAN",
  "ZRANDMEMBER",
  "ZUNION",
  "ZINTER",
  "ZDIFF",
  "ZINTERCARD",
  // streams
  "XRANGE",
  "XREVRANGE",
  "XLEN",
  "XREAD",
  "XINFO",
  "XPENDING",
  // geo (read-only variants)
  "GEOPOS",
  "GEODIST",
  "GEOHASH",
  "GEOSEARCH",
  "GEORADIUS_RO",
  "GEORADIUSBYMEMBER_RO",
  // hyperloglog / sort (read-only)
  "PFCOUNT",
  "SORT_RO",
  // JSON (read-only)
  "JSON.GET",
  "JSON.MGET",
  "JSON.TYPE",
  "JSON.STRLEN",
  "JSON.ARRLEN",
  "JSON.OBJLEN",
  "JSON.OBJKEYS",
  "JSON.RESP",
  "JSON.DEBUG",
  // Upstash Redis Search (read-only). Upstash uses SEARCH.* commands — these are
  // NOT the RediSearch FT.* commands (which Upstash does not support).
  "SEARCH.QUERY",
  "SEARCH.COUNT",
  "SEARCH.AGGREGATE",
  "SEARCH.DESCRIBE",
  "SEARCH.LISTINDEXES",
  "SEARCH.LISTALIASES",
  "SEARCH.WAITINDEXING",
]);

export function isReadOnlyCommand(command: string[]): boolean {
  const name = (command[0] ?? "").toUpperCase();
  return READ_ONLY_COMMANDS.has(name);
}

/** Throws if any command is not on the read-only allowlist. */
export function assertReadOnly(commands: string[][]): void {
  const blocked = commands.filter((c) => !isReadOnlyCommand(c)).map((c) => c[0] ?? "");
  if (blocked.length > 0) {
    throw new Error(
      `Read-only mode is enabled; refusing potential write command(s): ${[...new Set(blocked)].join(", ")}. ` +
        `Disable --readonly / UPSTASH_REDIS_READONLY to allow writes.`
    );
  }
}
