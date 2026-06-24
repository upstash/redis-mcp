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

export interface Config {
  /** name -> database. */
  databases: Map<string, DatabaseConfig>;
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

function finalizeTransport(partial: Partial<DatabaseConfig> & { name: string }): DatabaseConfig {
  if (partial.restUrl && partial.restToken) {
    return {
      name: partial.name,
      transport: "http",
      restUrl: partial.restUrl,
      restToken: partial.restToken,
    };
  }
  if (partial.connectionString) {
    return { name: partial.name, transport: "tcp", connectionString: partial.connectionString };
  }
  throw new Error(
    `Database "${partial.name}" is misconfigured: provide a REST url + token (HTTP) or a connection string (TCP).`
  );
}

/**
 * Parse databases from environment variables.
 *   Default HTTP:  UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
 *   Default TCP:   UPSTASH_REDIS_TCP_URL (or REDIS_URL)
 *   Named HTTP:    UPSTASH_REDIS_<NAME>_REST_URL + UPSTASH_REDIS_<NAME>_REST_TOKEN
 *   Named TCP:     UPSTASH_REDIS_<NAME>_TCP_URL
 * If a default DB has both REST and TCP credentials, HTTP wins.
 */
export function parseDatabasesFromEnv(env: NodeJS.ProcessEnv): Map<string, DatabaseConfig> {
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
    if (partials.get(DEFAULT_NAME)?.restUrl) {
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

  const result = new Map<string, DatabaseConfig>();
  for (const [name, partial] of partials) result.set(name, finalizeTransport(partial));
  return result;
}

/**
 * Extract database definitions from CLI argv. Recognized, repeatable flags:
 *   --database <name>          start a new database group
 *   --rest-url <url>           HTTP url for the current group (or default)
 *   --rest-token <token>       HTTP token for the current group (or default)
 *   --url / --tcp-url <conn>   TCP connection string for the current group
 * Flags before any --database apply to the "default" database.
 * Returns the parsed databases plus the remaining argv (for commander).
 */
export function parseDatabaseArgs(argv: string[]): {
  databases: Map<string, DatabaseConfig>;
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

  const databases = new Map<string, DatabaseConfig>();
  for (const [name, partial] of partials) databases.set(name, finalizeTransport(partial));
  return { databases, rest };
}

export function databaseNames(): string[] {
  return [...config.databases.keys()];
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
    return {
      name: "<raw>",
      transport: "http",
      restUrl: input.rest_url,
      restToken: input.rest_token,
    };
  }
  if (input.connection_string) {
    return { name: "<raw>", transport: "tcp", connectionString: input.connection_string };
  }
  if (input.database) {
    const db = config.databases.get(input.database.toLowerCase());
    if (!db) {
      throw new Error(
        `Unknown database "${input.database}". Configured: ${databaseNames().join(", ") || "(none)"}.`
      );
    }
    return db;
  }

  const names = databaseNames();
  if (names.length === 1) return config.databases.get(names[0])!;
  if (names.length === 0) {
    throw new Error(
      "No database configured. Provide rest_url + rest_token (HTTP) or connection_string (TCP) in the tool call, or configure one via env/CLI."
    );
  }
  throw new Error(`Multiple databases configured; set "database" to one of: ${names.join(", ")}.`);
}
