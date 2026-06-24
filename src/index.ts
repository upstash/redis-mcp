#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Command } from "commander";
// eslint-disable-next-line unicorn/prefer-node-protocol
import { createServer, type IncomingMessage } from "http";
import { createServerInstance } from "./server.js";
import { config, type DatabaseConfig, parseDatabaseArgs, parseDatabasesFromEnv } from "./config";
import { initDebugLog } from "./log";
import { closeAllTcp } from "./redis/tcp";
import "dotenv/config";

function envBool(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

// Pull database-definition flags (--database / --rest-url / --rest-token / --url)
// out of argv first; hand the rest to commander.
const { databases: cliDatabases, rest } = parseDatabaseArgs(process.argv.slice(2));

const program = new Command()
  .option("--transport <stdio|http>", "server transport", "stdio")
  .option("--port <number>", "port for HTTP transport", "3000")
  .option("--readonly", "best-effort: reject write commands")
  .option("--disable-telemetry", "disable Upstash-Telemetry-* headers on HTTP requests")
  .option("--debug", "enable debug logging")
  .allowUnknownOption();

program.parse(rest, { from: "user" });

const opts = program.opts<{
  transport: string;
  port: string;
  readonly?: boolean;
  disableTelemetry?: boolean;
  debug?: boolean;
}>();

const allowedTransports = ["stdio", "http"];
if (!allowedTransports.includes(opts.transport)) {
  console.error(`Invalid --transport value: '${opts.transport}'. Must be one of: stdio, http.`);
  process.exit(1);
}

config.serverTransport = opts.transport as "stdio" | "http";
config.debug = opts.debug ?? false;
if (config.debug) initDebugLog(new URL("../", import.meta.url).pathname);

const parsedPort = Number.parseInt(opts.port, 10);
config.port = Number.isNaN(parsedPort) ? 3000 : parsedPort;

config.readonly = (opts.readonly ?? false) || envBool(process.env.UPSTASH_REDIS_READONLY);
config.disableTelemetry =
  (opts.disableTelemetry ?? false) || envBool(process.env.UPSTASH_DISABLE_TELEMETRY);

// Merge databases: environment first, CLI definitions override by name.
const databases = new Map<string, DatabaseConfig>(parseDatabasesFromEnv(process.env));
for (const [name, db] of cliDatabases) databases.set(name, db);
config.databases = databases;

if (databases.size === 0) {
  console.error(
    "No Upstash Redis database configured via env/CLI — redis_run_commands will require raw " +
      "credentials (rest_url + rest_token, or connection_string) in each call. To configure one, " +
      "set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or UPSTASH_REDIS_TCP_URL) or pass " +
      "--rest-url/--rest-token/--url."
  );
}

const shutdown = () => {
  void closeAllTcp().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function main() {
  if (config.serverTransport === "http") {
    const initialPort = config.port;
    let actualPort = initialPort;

    const httpServer = createServer(async (req: IncomingMessage, res: any) => {
      const pathname = new (globalThis as any).URL(req.url || "", `http://${req.headers.host}`)
        .pathname;

      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS,DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, MCP-Session-Id, MCP-Protocol-Version, Authorization"
      );
      res.setHeader("Access-Control-Expose-Headers", "MCP-Session-Id");

      if (req.method === "OPTIONS") {
        res.writeHead(200);
        res.end();
        return;
      }

      try {
        if (pathname === "/mcp") {
          const requestServer = createServerInstance();
          const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
          await requestServer.connect(transport);
          await transport.handleRequest(req, res);
        } else if (pathname === "/ping") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", message: "pong" }));
        } else {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found", status: 404 }));
        }
      } catch (error) {
        console.error("Error handling request:", error);
        if (!res.headersSent) {
          res.writeHead(500);
          res.end("Internal Server Error");
        }
      }
    });

    const startServer = (port: number, maxAttempts = 10) => {
      httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && port < initialPort + maxAttempts) {
          console.warn(`Port ${port} is in use, trying port ${port + 1}...`);
          startServer(port + 1, maxAttempts);
        } else {
          console.error(`Failed to start server: ${err.message}`);
          process.exit(1);
        }
      });

      httpServer.listen(port, () => {
        actualPort = port;
        console.error(
          `Upstash Redis MCP Server running on HTTP at http://localhost:${actualPort}/mcp`
        );
      });
    };

    startServer(initialPort);
  } else {
    const server = createServerInstance();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Upstash Redis MCP Server running on stdio");
  }
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
