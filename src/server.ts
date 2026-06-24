import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";
import { config } from "./config";
import { log } from "./log";
import { getTools } from "./tools";
import { handlerResponseToCallResult } from "./tool";
import { VERSION } from "./version.js";

export function createServerInstance() {
  const server = new McpServer(
    { name: "redis-mcp", version: VERSION },
    {
      capabilities: {
        tools: {},
        logging: {},
      },
    }
  );

  const tools = getTools();

  for (const [toolName, tool] of Object.entries(tools)) {
    server.registerTool(
      toolName,
      {
        description: tool.description,
        inputSchema: ((tool.inputSchema ?? z.object({})) as any).shape,
      },
      // @ts-expect-error - the SDK's generic handler typing is too strict here
      async (args) => {
        log("< tool call:", toolName, args);
        try {
          const response = handlerResponseToCallResult(await tool.handler(args));
          return response;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log("> tool error:", message);
          return {
            content: [
              {
                type: "text",
                text: `${error instanceof Error ? error.name : "Error"}: ${message}`,
              },
              ...(config.debug && error instanceof Error
                ? [{ type: "text", text: `\nStack trace: ${error.stack ?? "n/a"}` }]
                : []),
            ],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}
