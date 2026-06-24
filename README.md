<div align="center">

# Upstash Redis MCP

[![Add to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/install-mcp?name=upstash-redis&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB1cHN0YXNoL3JlZGlzLW1jcCJdfQ==)

<br />

<img src="https://github.com/user-attachments/assets/318cdf99-2e6c-4307-879e-f831c8fe3983" alt="An agent using the Upstash Redis MCP from the terminal" width="760" />

</div>

---

Lightweight MCP server for Redis with only two tools:

- 🧪 **`redis_run_commands`**: run one or more Redis commands over **HTTP/REST** or **TCP**, as a pipeline or an atomic transaction.
- 📚 **`redis_search_docs`**: search the Redis docs using [Context7](https://context7.com) public api.

One server can hold multiple named databases. Configuration is pure environment variables and CLI flags.

## 🔌 Quickstart

<details>
<summary><b>Claude Code</b></summary>

Run this in your terminal. See the [Claude Code MCP docs](https://docs.anthropic.com/en/docs/claude-code/mcp) for more.

```bash
claude mcp add upstash-redis \
  -e UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io \
  -e UPSTASH_REDIS_REST_TOKEN=<your-rest-token> \
  -- npx -y @upstash/redis-mcp
```

</details>

<details>
<summary><b>Cursor</b></summary>

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project), or go to **Settings → MCP → Add new MCP server**. See the [Cursor MCP docs](https://docs.cursor.com/context/model-context-protocol).

```json
{
  "mcpServers": {
    "upstash-redis": {
      "command": "npx",
      "args": ["-y", "@upstash/redis-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://<your-db>.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "<your-rest-token>"
      }
    }
  }
}
```

</details>

<details>
<summary><b>VS Code</b></summary>

Add to `.vscode/mcp.json` (per-project) or your user `mcp` settings. See the [VS Code MCP docs](https://code.visualstudio.com/docs/copilot/chat/mcp-servers).

```json
{
  "servers": {
    "upstash-redis": {
      "command": "npx",
      "args": ["-y", "@upstash/redis-mcp"],
      "env": {
        "UPSTASH_REDIS_REST_URL": "https://<your-db>.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "<your-rest-token>"
      }
    }
  }
}
```

</details>

<details>
<summary><b>Codex</b></summary>

Add to `~/.codex/config.toml` (or a project-level `.codex/config.toml`). See the [Codex MCP docs](https://developers.openai.com/codex/mcp).

```toml
[mcp_servers.upstash-redis]
command = "npx"
args = ["-y", "@upstash/redis-mcp"]
env = { UPSTASH_REDIS_REST_URL = "https://<your-db>.upstash.io", UPSTASH_REDIS_REST_TOKEN = "<your-rest-token>" }
```

</details>

<details>
<summary><b>OpenCode</b></summary>

Add to `opencode.json` (project) or `~/.config/opencode/opencode.json` (global). See the [OpenCode MCP docs](https://opencode.ai/docs/mcp-servers).

```json
{
  "mcp": {
    "upstash-redis": {
      "type": "local",
      "command": ["npx", "-y", "@upstash/redis-mcp"],
      "environment": {
        "UPSTASH_REDIS_REST_URL": "https://<your-db>.upstash.io",
        "UPSTASH_REDIS_REST_TOKEN": "<your-rest-token>"
      }
    }
  }
}
```

</details>

> [!TIP]
> Any MCP-compatible client works. If yours isn't listed, add a **stdio** server that runs `npx -y @upstash/redis-mcp` with the two env vars above.

## 🧰 Tools

### 🧪 `redis_run_commands`

Run any Redis command: `GET`, `SET`, `SCAN`, `ZADD`, `EVAL`, the `SEARCH.*` family, and everything else. Each command is an array of args (numbers are accepted and coerced to strings). By default multiple commands run as a **pipeline**: each returns its own result/error, aligned to the input, and one failure doesn't abort the rest. Set `transaction: true` for an atomic `MULTI/EXEC`.

```jsonc
{
  "commands": [
    ["SET", "visits", 0],
    ["INCR", "visits"],
    ["GET", "visits"],
  ],
  "transaction": false, // optional: true => atomic MULTI/EXEC
  // "database": "prod"       // only when more than one database is configured
  // raw credential overrides (optional):
  // "rest_url", "rest_token" // HTTP
  // "connection_string"      // TCP, rediss://
}
```

The transport (HTTP vs TCP) is determined by how the target database is configured; the agent never picks it.

### 📚 `redis_search_docs`

Searches the Upstash Redis documentation live and returns the most relevant pages. Reach for it whenever you're unsure about a command or feature, especially Upstash-specific ones like the `SEARCH.*` full-text search family. It's powered by [Context7](https://context7.com)'s free tier, so no API key or extra setup is required.

```jsonc
{ "query": "SEARCH.AGGREGATE date histogram" }
```

## ⚙️ Configuration

Everything is set through environment variables and CLI flags; there are no config files.

### Single database

| Transport | Environment                                           | CLI                                     |
| --------- | ----------------------------------------------------- | --------------------------------------- |
| HTTP      | `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | `--rest-url <url> --rest-token <token>` |
| TCP       | `UPSTASH_REDIS_TCP_URL` (or `REDIS_URL`)              | `--url <rediss://…>`                    |

### Multiple databases

Give each database a name. The name becomes a selectable `database` value in `redis_run_commands`.

**Environment**: insert a `<NAME>` segment:

```bash
UPSTASH_REDIS_PROD_REST_URL="https://prod-db.upstash.io"
UPSTASH_REDIS_PROD_REST_TOKEN="<prod-rest-token>"
UPSTASH_REDIS_CACHE_TCP_URL="rediss://default:<password>@cache-db.upstash.io:6379"
```

**CLI**: repeat `--database` to start each group:

```bash
npx -y @upstash/redis-mcp \
  --database prod  --rest-url https://prod-db.upstash.io --rest-token <prod-rest-token> \
  --database cache --url rediss://default:<password>@cache-db.upstash.io:6379
```

> [!NOTE]
> **Raw credentials per call.** A `redis_run_commands` call may also pass `rest_url` + `rest_token` (HTTP) or `connection_string` (TCP) inline; these override the registry and work even with no configured database. They flow through the model's context, so prefer env/CLI for anything sensitive.

### Flags & options

| Flag                        | Env                         | Default | Purpose                                                                                                            |
| --------------------------- | --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `--transport <stdio\|http>` |                             | `stdio` | Server transport                                                                                                   |
| `--port <n>`                |                             | `3000`  | Port for the `http` transport                                                                                      |
| `--readonly`                | `UPSTASH_REDIS_READONLY`    | off     | Best-effort: reject write commands on both transports. Server-side read-only REST tokens remain the robust option. |
| `--disable-telemetry`       | `UPSTASH_DISABLE_TELEMETRY` | off     | Stop sending `Upstash-Telemetry-*` headers on HTTP requests                                                        |
| `--debug`                   |                             | off     | Verbose logging to stderr + `redis-mcp-debug.log`                                                                  |

## 📡 Telemetry

HTTP/REST requests carry `Upstash-Telemetry-{Sdk,Platform,Runtime}` headers. Disable with `--disable-telemetry` or `UPSTASH_DISABLE_TELEMETRY=true`.

## 🛠️ Development

```bash
bun install
bun run build
bun test
bun run lint
```

## 📄 License

[MIT](./LICENSE) © Upstash
