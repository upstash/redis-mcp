import { describe, expect, test } from "bun:test";
import {
  config,
  normalizeConnString,
  normalizeRestUrl,
  parseDatabaseArgs,
  parseDatabasesFromEnv,
  resolveDatabase,
  type ConfigIssue,
  type DatabaseConfig,
} from "./config";

describe("parseDatabasesFromEnv", () => {
  test("default HTTP database", () => {
    const { databases } = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(databases.get("default")).toEqual({
      name: "default",
      transport: "http",
      restUrl: "https://db.upstash.io",
      restToken: "tok",
    });
  });

  test("default TCP via UPSTASH_REDIS_TCP_URL", () => {
    const { databases } = parseDatabasesFromEnv({
      UPSTASH_REDIS_TCP_URL: "rediss://default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(databases.get("default")).toEqual({
      name: "default",
      transport: "tcp",
      connectionString: "rediss://default:pw@db.upstash.io:6379",
    });
  });

  test("REST wins over TCP for the default database", () => {
    const { databases } = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
      UPSTASH_REDIS_TCP_URL: "rediss://default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(databases.get("default")?.transport).toBe("http");
  });

  test("named HTTP + TCP databases", () => {
    const { databases } = parseDatabasesFromEnv({
      UPSTASH_REDIS_PROD_REST_URL: "https://prod.upstash.io",
      UPSTASH_REDIS_PROD_REST_TOKEN: "ptok",
      UPSTASH_REDIS_CACHE_TCP_URL: "rediss://default:pw@cache.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(databases.get("prod")?.transport).toBe("http");
    expect(databases.get("cache")?.transport).toBe("tcp");
    expect([...databases.keys()].sort()).toEqual(["cache", "prod"]);
  });

  test("scheme-less REST URL is normalized to https://", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "xxx.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(issues).toEqual([]);
    expect(databases.get("default")?.restUrl).toBe("https://xxx.upstash.io");
  });

  test("URL set but token missing -> issue naming the token var, no database", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
    } as NodeJS.ProcessEnv);
    expect(databases.size).toBe(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].name).toBe("default");
    expect(issues[0].message).toContain("UPSTASH_REDIS_REST_TOKEN");
  });

  test("named token without URL -> issue naming the URL var", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_PROD_REST_TOKEN: "ptok",
    } as NodeJS.ProcessEnv);
    expect(databases.size).toBe(0);
    expect(issues[0].name).toBe("prod");
    expect(issues[0].message).toContain("UPSTASH_REDIS_PROD_REST_URL");
  });

  test("stray REST_URL (no token) does not mask a valid TCP for the default database", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
      UPSTASH_REDIS_TCP_URL: "rediss://default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(issues).toEqual([]);
    expect(databases.get("default")?.transport).toBe("tcp");
  });

  test("stray REST_URL does not mask a valid TCP for a named database", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_PROD_REST_URL: "https://prod.upstash.io",
      UPSTASH_REDIS_PROD_TCP_URL: "rediss://default:pw@prod.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(issues).toEqual([]);
    expect(databases.get("prod")?.transport).toBe("tcp");
  });

  test("bad TCP scheme -> issue without leaking the connection string", () => {
    const { databases, issues } = parseDatabasesFromEnv({
      UPSTASH_REDIS_TCP_URL: "default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(databases.size).toBe(0);
    expect(issues[0].message).toContain("redis://");
    expect(issues[0].message).not.toContain("pw");
  });
});

describe("parseDatabaseArgs", () => {
  test("default group from leading flags", () => {
    const { databases, rest } = parseDatabaseArgs([
      "--rest-url",
      "https://db.upstash.io",
      "--rest-token",
      "tok",
      "--transport",
      "http",
    ]);
    expect(databases.get("default")?.transport).toBe("http");
    expect(rest).toEqual(["--transport", "http"]);
  });

  test("multiple named groups", () => {
    const { databases } = parseDatabaseArgs([
      "--database",
      "prod",
      "--rest-url",
      "https://prod.upstash.io",
      "--rest-token",
      "ptok",
      "--database",
      "cache",
      "--url",
      "rediss://default:pw@cache.upstash.io:6379",
    ]);
    expect(databases.get("prod")?.transport).toBe("http");
    expect(databases.get("cache")?.transport).toBe("tcp");
  });

  test("partial CLI creds -> issue referencing CLI flags", () => {
    const { databases, issues } = parseDatabaseArgs(["--rest-url", "https://db.upstash.io"]);
    expect(databases.size).toBe(0);
    expect(issues[0].message).toContain("--rest-token");
  });
});

describe("normalizeRestUrl", () => {
  test("prepends https:// when scheme missing", () => {
    expect(normalizeRestUrl("xxx.upstash.io")).toEqual({
      ok: true,
      value: "https://xxx.upstash.io",
    });
  });
  test("keeps an explicit scheme", () => {
    expect(normalizeRestUrl("http://localhost:8080")).toEqual({
      ok: true,
      value: "http://localhost:8080",
    });
  });
  test("rejects a non-http(s) scheme", () => {
    const r = normalizeRestUrl("ftp://x");
    expect(r.ok).toBe(false);
  });
  test("rejects a connection string without leaking its password", () => {
    const r = normalizeRestUrl("rediss://default:SUPERSECRET@db.upstash.io:6379");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).not.toContain("SUPERSECRET");
  });
  test("rejects an http URL that embeds credentials, without leaking them", () => {
    const r = normalizeRestUrl("https://user:SECRET@db.upstash.io");
    expect(r.ok).toBe(false);
    expect(r.ok ? "" : r.message).not.toContain("SECRET");
  });
  test("rejects a protocol-relative URL", () => {
    expect(normalizeRestUrl("//db.upstash.io").ok).toBe(false);
  });
});

describe("normalizeConnString", () => {
  test("accepts redis:// and rediss://", () => {
    expect(normalizeConnString("rediss://x").ok).toBe(true);
    expect(normalizeConnString("redis://x").ok).toBe(true);
  });
  test("rejects a scheme-less string", () => {
    expect(normalizeConnString("default:pw@host:6379").ok).toBe(false);
  });
});

function withDatabases(dbs: DatabaseConfig[], issues: ConfigIssue[] = []): void {
  config.databases = new Map(dbs.map((d) => [d.name, d]));
  config.configIssues = issues;
}

describe("resolveDatabase", () => {
  test("raw HTTP credentials take precedence", () => {
    withDatabases([{ name: "default", transport: "tcp", connectionString: "rediss://x" }]);
    const db = resolveDatabase({ rest_url: "https://raw.upstash.io", rest_token: "rtok" });
    expect(db).toEqual({
      name: "<raw>",
      transport: "http",
      restUrl: "https://raw.upstash.io",
      restToken: "rtok",
    });
  });

  test("raw HTTP url without scheme is normalized", () => {
    withDatabases([]);
    const db = resolveDatabase({ rest_url: "raw.upstash.io", rest_token: "rtok" });
    expect(db.restUrl).toBe("https://raw.upstash.io");
  });

  test("raw TCP credentials", () => {
    withDatabases([]);
    const db = resolveDatabase({ connection_string: "rediss://default:pw@db.upstash.io:6379" });
    expect(db.transport).toBe("tcp");
  });

  test("raw TCP without a redis scheme is rejected", () => {
    withDatabases([]);
    expect(() => resolveDatabase({ connection_string: "default:pw@db:6379" })).toThrow(
      /Invalid connection_string/
    );
  });

  test("named database", () => {
    withDatabases([
      { name: "prod", transport: "http", restUrl: "https://prod", restToken: "t" },
      { name: "cache", transport: "tcp", connectionString: "rediss://c" },
    ]);
    expect(resolveDatabase({ database: "cache" }).transport).toBe("tcp");
  });

  test("single database is used implicitly", () => {
    withDatabases([{ name: "default", transport: "http", restUrl: "https://d", restToken: "t" }]);
    expect(resolveDatabase({}).name).toBe("default");
  });

  test("throws when multiple databases and none selected", () => {
    withDatabases([
      { name: "prod", transport: "http", restUrl: "https://prod", restToken: "t" },
      { name: "cache", transport: "tcp", connectionString: "rediss://c" },
    ]);
    expect(() => resolveDatabase({})).toThrow(/Multiple databases/);
  });

  test("surfaces config issues in the multiple-databases error", () => {
    withDatabases(
      [
        { name: "prod", transport: "http", restUrl: "https://prod", restToken: "t" },
        { name: "cache", transport: "tcp", connectionString: "rediss://c" },
      ],
      [{ name: "stage", message: "UPSTASH_REDIS_STAGE_REST_TOKEN is missing" }]
    );
    expect(() => resolveDatabase({})).toThrow(/UPSTASH_REDIS_STAGE_REST_TOKEN is missing/);
  });

  test("throws on unknown database name", () => {
    withDatabases([{ name: "prod", transport: "http", restUrl: "https://p", restToken: "t" }]);
    expect(() => resolveDatabase({ database: "nope" })).toThrow(/Unknown database/);
  });

  test("throws when no database configured and no raw creds", () => {
    withDatabases([]);
    expect(() => resolveDatabase({})).toThrow(/No database configured/);
  });

  test("surfaces config issues in the no-database error", () => {
    withDatabases([], [{ name: "default", message: "UPSTASH_REDIS_REST_TOKEN is missing" }]);
    expect(() => resolveDatabase({})).toThrow(/UPSTASH_REDIS_REST_TOKEN is missing/);
  });

  test("throws on partial raw HTTP creds", () => {
    withDatabases([]);
    expect(() => resolveDatabase({ rest_url: "https://x" })).toThrow(
      /both rest_url and rest_token/
    );
  });
});
