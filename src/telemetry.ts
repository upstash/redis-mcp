import { VERSION } from "./version.js";

function getRuntime(): string {
  if ((globalThis as any).Bun !== undefined) {
    return `bun@${(globalThis as any).Bun.version}`;
  }
  if ((globalThis as any).Deno !== undefined) {
    const denoVersion = (globalThis as any).Deno?.version?.deno;
    return denoVersion ? `deno@${denoVersion}` : "deno";
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    return `node@${process.versions.node}`;
  }
  return "unknown";
}

function getPlatform(): string {
  if (typeof process !== "undefined" && process.platform) {
    return process.platform;
  }
  return "unknown";
}

export const telemetry = {
  runtime: getRuntime(),
  platform: getPlatform(),
  sdk: `@upstash/redis-mcp@${VERSION}`,
};

/**
 * Telemetry headers sent with HTTP/REST requests to Upstash, matching the
 * @upstash/redis SDK and the Upstash MCP server. Returns an empty object when
 * telemetry is disabled. TCP connections have no header channel, so they send
 * no telemetry.
 */
export function telemetryHeaders(disabled: boolean): Record<string, string> {
  if (disabled) return {};
  return {
    "Upstash-Telemetry-Runtime": telemetry.runtime,
    "Upstash-Telemetry-Platform": telemetry.platform,
    "Upstash-Telemetry-Sdk": telemetry.sdk,
  };
}
