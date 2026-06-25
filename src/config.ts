export type Transport = "http" | "tcp";

export interface DatabaseConfig {
  /** Alias used to select this database in the run-commands tool. */
  name: string;
  transport: Transport;
  /** HTTP transport: Upstash REST endpoint, e.g. https://xxx.upstash.io */
  restUrl?: string;
  /** HTTP transport: Upstash REST token. */
  restToken?: string;
  /** TCP transport: rediss:// connection string. */
  connectionString?: string;
}

/** A database that could not be configured, with a human-actionable reason. */
export interface ConfigIssue {
  name: string;
  message: string;
}

export interface Config {
  /** name -> database. */
  databases: Map<string, DatabaseConfig>;
  /**
   * Per-database configuration problems (bad/partial credentials). These are
   * surfaced in tool-call errors — over MCP the agent only sees tool results,
   * never stderr — so a misconfig never silently looks like "no database".
   */
  configIssues: ConfigIssue[];
  /** Best-effort: reject write commands when true. */
  readonly: boolean;
  /** Stop sending Upstash-Telemetry-* headers on HTTP requests. */
  disableTelemetry: boolean;
  debug: boolean;
  serverTransport: "stdio" | "http";
  port: number;
}

export const config: Config = {
  databases: new Map(),
  configIssues: [],
  readonly: false,
  disableTelemetry: false,
  debug: false,
  serverTransport: "stdio",
  port: 3000,
};

const DEFAULT_NAME = "default";

/** Raw-credential override fields accepted by the run-commands tool. */
export interface CredentialInput {
  database?: string;
  rest_url?: string;
  rest_token?: string;
  connection_string?: string;
}

/** How to refer to each credential for a given source (env var names or CLI flags). */
interface CredLabels {
  url: string;
  token: string;
  conn: string;
}

const CLI_LABELS: CredLabels = { url: "--rest-url", token: "--rest-token", conn: "--url" };

function envLabels(name: string): CredLabels {
  const prefix = name === DEFAULT_NAME ? "UPSTASH_REDIS" : `UPSTASH_REDIS_${name.toUpperCase()}`;
  return {
    url: `${prefix}_REST_URL`,
    token: `${prefix}_REST_TOKEN`,
    conn: name === DEFAULT_NAME ? "UPSTASH_REDIS_TCP_URL" : `${prefix}_TCP_URL`,
  };
}

type Normalized = { ok: true; value: string } | { ok: false; message: string };

/**
 * Normalize a REST URL: trim, default the scheme to https:// when missing
 * (a common copy-paste slip), and reject anything that isn't http(s). Error
 * messages never echo the raw input — a misplaced connection string would leak
 * its password into the (agent-visible) tool result — so they describe only the
 * non-secret parts (scheme/host).
 */
export function normalizeRestUrl(raw: string): Normalized {
  let value = raw.trim();
  if (!value) return { ok: false, message: "REST URL is empty." };
  // Protocol-relative ("//host") would otherwise become "https:////host".
  if (value.startsWith("//")) {
    return { ok: false, message: "REST URL is missing a scheme (expected https://)." };
  }
  if (!/^[a-z][\d+.a-z-]*:\/\//i.test(value)) value = `https://${value}`;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, message: "REST URL is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      ok: false,
      message: `REST URL must be http(s), not "${parsed.protocol}" — if this is a TCP connection string, use connection_string / UPSTASH_REDIS_*_TCP_URL instead.`,
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      message:
        "REST URL must not embed credentials (user:pass@host) — provide the token separately via rest_token / UPSTASH_REDIS_*_REST_TOKEN.",
    };
  }
  return { ok: true, value };
}

/**
 * Normalize a TCP connection string: require a redis:// or rediss:// scheme.
 * The string carries the password, so it is never echoed back in errors.
 */
export function normalizeConnString(raw: string): Normalized {
  const value = raw.trim();
  if (!value) return { ok: false, message: "TCP connection string is empty." };
  if (!/^rediss?:\/\//i.test(value)) {
    return { ok: false, message: "TCP connection string must start with redis:// or rediss://." };
  }
  return { ok: true, value };
}

type FinalizeResult = { ok: true; db: DatabaseConfig } | { ok: false; message: string };

function finalizeTransport(
  partial: Partial<DatabaseConfig> & { name: string },
  labels: CredLabels
): FinalizeResult {
  const { name } = partial;
  const hasUrl = Boolean(partial.restUrl);
  const hasToken = Boolean(partial.restToken);

  // Full HTTP credentials.
  if (hasUrl && hasToken) {
    const url = normalizeRestUrl(partial.restUrl!);
    if (!url.ok) return { ok: false, message: `Database "${name}": ${url.message}` };
    return {
      ok: true,
      db: { name, transport: "http", restUrl: url.value, restToken: partial.restToken },
    };
  }

  // Full TCP credentials. Checked before the partial-REST diagnostics so a
  // stray REST_URL doesn't mask an otherwise-valid TCP database.
  if (partial.connectionString) {
    const conn = normalizeConnString(partial.connectionString);
    if (!conn.ok) return { ok: false, message: `Database "${name}": ${conn.message}` };
    return { ok: true, db: { name, transport: "tcp", connectionString: conn.value } };
  }

  // Partial HTTP credentials — name exactly what's missing.
  if (hasUrl && !hasToken) {
    return {
      ok: false,
      message: `Database "${name}": ${labels.url} is set but ${labels.token} is missing — add the token, or remove the URL to disable this database.`,
    };
  }
  if (hasToken && !hasUrl) {
    return {
      ok: false,
      message: `Database "${name}": ${labels.token} is set but ${labels.url} is missing — add the URL, or remove the token to disable this database.`,
    };
  }

  return {
    ok: false,
    message: `Database "${name}" is misconfigured: provide ${labels.url} + ${labels.token} (HTTP) or ${labels.conn} (TCP).`,
  };
}

/** Resolve a set of partials into databases + issues using the given labels. */
function finalizeAll(
  partials: Map<string, Partial<DatabaseConfig> & { name: string }>,
  labelsFor: (name: string) => CredLabels
): { databases: Map<string, DatabaseConfig>; issues: ConfigIssue[] } {
  const databases = new Map<string, DatabaseConfig>();
  const issues: ConfigIssue[] = [];
  for (const [name, partial] of partials) {
    const result = finalizeTransport(partial, labelsFor(name));
    if (result.ok) databases.set(name, result.db);
    else issues.push({ name, message: result.message });
  }
  return { databases, issues };
}

/**
 * Parse databases from environment variables.
 *   Default HTTP:  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   Default TCP:   UPSTASH_REDIS_TCP_URL (or REDIS_URL)
 *   Named HTTP:    UPSTASH_REDIS_<NAME>_REST_URL + UPSTASH_REDIS_<NAME>_REST_TOKEN
 *   Named TCP:     UPSTASH_REDIS_<NAME>_TCP_URL
 * If a default DB has both REST and TCP credentials, HTTP wins.
 */
export function parseDatabasesFromEnv(env: NodeJS.ProcessEnv): {
  databases: Map<string, DatabaseConfig>;
  issues: ConfigIssue[];
} {
  const partials = new Map<string, Partial<DatabaseConfig> & { name: string }>();
  const upsert = (name: string, patch: Partial<DatabaseConfig>) => {
    const existing = partials.get(name) ?? { name };
    partials.set(name, { ...existing, ...patch });
  };

  // Default database.
  if (env.UPSTASH_REDIS_REST_URL) {
    upsert(DEFAULT_NAME, {
      restUrl: env.UPSTASH_REDIS_REST_URL,
      restToken: env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  const defaultTcp = env.UPSTASH_REDIS_TCP_URL || env.REDIS_URL;
  if (defaultTcp) {
    const existing = partials.get(DEFAULT_NAME);
    // Only let REST win over TCP when REST is *complete*. A stray REST_URL with
    // no token must not discard an otherwise-valid TCP connection string.
    if (existing?.restUrl && existing?.restToken) {
      console.error(
        "Both REST and TCP credentials set for the default database; using HTTP (REST). Give the TCP database a distinct name to use it too."
      );
    } else {
      upsert(DEFAULT_NAME, { connectionString: defaultTcp });
    }
  }

  // Named databases.
  const restUrlRe = /^UPSTASH_REDIS_(.+)_REST_URL$/;
  const restTokenRe = /^UPSTASH_REDIS_(.+)_REST_TOKEN$/;
  const tcpUrlRe = /^UPSTASH_REDIS_(.+)_TCP_URL$/;

  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    let m: RegExpExecArray | null;
    if ((m = restUrlRe.exec(key))) upsert(m[1].toLowerCase(), { restUrl: value });
    else if ((m = restTokenRe.exec(key))) upsert(m[1].toLowerCase(), { restToken: value });
    else if ((m = tcpUrlRe.exec(key))) upsert(m[1].toLowerCase(), { connectionString: value });
  }

  return finalizeAll(partials, envLabels);
}

/**
 * Extract database definitions from CLI argv. Recognized, repeatable flags:
 *   --database <name>          start a new database group
 *   --rest-url <url>           HTTP url for the current group (or default)
 *   --rest-token <token>       HTTP token for the current group (or default)
 *   --url / --tcp-url <conn>   TCP connection string for the current group
 * Flags before any --database apply to the "default" database.
 * Returns the parsed databases, any config issues, plus the remaining argv (for commander).
 */
export function parseDatabaseArgs(argv: string[]): {
  databases: Map<string, DatabaseConfig>;
  issues: ConfigIssue[];
  rest: string[];
} {
  const partials = new Map<string, Partial<DatabaseConfig> & { name: string }>();
  const rest: string[] = [];
  let current = DEFAULT_NAME;

  const ensure = (name: string) => {
    if (!partials.has(name)) partials.set(name, { name });
    return partials.get(name)!;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    switch (arg) {
      case "--database": {
        current = (next() ?? "").toLowerCase() || DEFAULT_NAME;
        ensure(current);
        break;
      }
      case "--rest-url": {
        ensure(current).restUrl = next();
        break;
      }
      case "--rest-token": {
        ensure(current).restToken = next();
        break;
      }
      case "--url":
      case "--tcp-url":
      case "--connection-string": {
        ensure(current).connectionString = next();
        break;
      }
      default: {
        rest.push(arg);
      }
    }
  }

  const { databases, issues } = finalizeAll(partials, () => CLI_LABELS);
  return { databases, issues, rest };
}

export function databaseNames(): string[] {
  return [...config.databases.keys()];
}

/** Format collected config issues for inclusion in a tool-call error. */
function issuesSuffix(): string {
  if (config.configIssues.length === 0) return "";
  const lines = config.configIssues.map((i) => `  - ${i.message}`).join("\n");
  return `\nDetected configuration problems:\n${lines}`;
}

/**
 * Resolve which database a run-commands call targets. Precedence:
 * raw HTTP creds -> raw TCP creds -> named `database` -> sole default DB.
 */
export function resolveDatabase(input: CredentialInput): DatabaseConfig {
  if (input.rest_url || input.rest_token) {
    if (!input.rest_url || !input.rest_token) {
      throw new Error("Provide both rest_url and rest_token for raw HTTP credentials.");
    }
    const url = normalizeRestUrl(input.rest_url);
    if (!url.ok) throw new Error(`Invalid rest_url: ${url.message}`);
    return {
      name: "<raw>",
      transport: "http",
      restUrl: url.value,
      restToken: input.rest_token,
    };
  }
  if (input.connection_string) {
    const conn = normalizeConnString(input.connection_string);
    if (!conn.ok) throw new Error(`Invalid connection_string: ${conn.message}`);
    return { name: "<raw>", transport: "tcp", connectionString: conn.value };
  }
  if (input.database) {
    const db = config.databases.get(input.database.toLowerCase());
    if (!db) {
      throw new Error(
        `Unknown database "${input.database}". Configured: ${databaseNames().join(", ") || "(none)"}.${issuesSuffix()}`
      );
    }
    return db;
  }

  const names = databaseNames();
  if (names.length === 1) return config.databases.get(names[0])!;
  if (names.length === 0) {
    throw new Error(
      "No database configured. Provide rest_url + rest_token (HTTP) or connection_string (TCP) in the tool call, or configure one via env/CLI." +
        issuesSuffix()
    );
  }
  throw new Error(
    `Multiple databases configured; set "database" to one of: ${names.join(", ")}.${issuesSuffix()}`
  );
}
