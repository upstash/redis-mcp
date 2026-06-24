import { describe, expect, test } from "bun:test";
import {
  config,
  parseDatabaseArgs,
  parseDatabasesFromEnv,
  resolveDatabase,
  type DatabaseConfig,
} from "./config";

describe("parseDatabasesFromEnv", () => {
  test("default HTTP database", () => {
    const dbs = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
    } as NodeJS.ProcessEnv);
    expect(dbs.get("default")).toEqual({
      name: "default",
      transport: "http",
      restUrl: "https://db.upstash.io",
      restToken: "tok",
    });
  });

  test("default TCP via UPSTASH_REDIS_TCP_URL", () => {
    const dbs = parseDatabasesFromEnv({
      UPSTASH_REDIS_TCP_URL: "rediss://default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(dbs.get("default")).toEqual({
      name: "default",
      transport: "tcp",
      connectionString: "rediss://default:pw@db.upstash.io:6379",
    });
  });

  test("REST wins over TCP for the default database", () => {
    const dbs = parseDatabasesFromEnv({
      UPSTASH_REDIS_REST_URL: "https://db.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "tok",
      UPSTASH_REDIS_TCP_URL: "rediss://default:pw@db.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(dbs.get("default")?.transport).toBe("http");
  });

  test("named HTTP + TCP databases", () => {
    const dbs = parseDatabasesFromEnv({
      UPSTASH_REDIS_PROD_REST_URL: "https://prod.upstash.io",
      UPSTASH_REDIS_PROD_REST_TOKEN: "ptok",
      UPSTASH_REDIS_CACHE_TCP_URL: "rediss://default:pw@cache.upstash.io:6379",
    } as NodeJS.ProcessEnv);
    expect(dbs.get("prod")?.transport).toBe("http");
    expect(dbs.get("cache")?.transport).toBe("tcp");
    expect([...dbs.keys()].sort()).toEqual(["cache", "prod"]);
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
});

function withDatabases(dbs: DatabaseConfig[]): void {
  config.databases = new Map(dbs.map((d) => [d.name, d]));
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

  test("raw TCP credentials", () => {
    withDatabases([]);
    const db = resolveDatabase({ connection_string: "rediss://default:pw@db.upstash.io:6379" });
    expect(db.transport).toBe("tcp");
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

  test("throws on unknown database name", () => {
    withDatabases([{ name: "prod", transport: "http", restUrl: "https://p", restToken: "t" }]);
    expect(() => resolveDatabase({ database: "nope" })).toThrow(/Unknown database/);
  });

  test("throws when no database configured and no raw creds", () => {
    withDatabases([]);
    expect(() => resolveDatabase({})).toThrow(/No database configured/);
  });

  test("throws on partial raw HTTP creds", () => {
    withDatabases([]);
    expect(() => resolveDatabase({ rest_url: "https://x" })).toThrow(
      /both rest_url and rest_token/
    );
  });
});
