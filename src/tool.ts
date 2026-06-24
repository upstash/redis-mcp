import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ZodSchema } from "zod";
import type { z } from "zod";

type HandlerResponse = string | string[] | CallToolResult;

export type CustomTool<TSchema extends ZodSchema = ZodSchema> = {
  description: string;

  /**
   * Zod schema for the input of the tool.
   */
  inputSchema?: TSchema;

  /**
   * The handler function for the tool.
   * @param input Parsed input according to the input schema.
   * @returns
   * If result is a string, it will be displayed as a single text block.
   * If result is an array of strings, each string will be displayed as a separate text block.
   * You can also return a CallToolResult object to display more complex content.
   */
  handler: (input: z.infer<TSchema>) => Promise<HandlerResponse>;
};

export function handlerResponseToCallResult(response: HandlerResponse): CallToolResult {
  if (typeof response === "string" || Array.isArray(response)) {
    const array = Array.isArray(response) ? response : [response];
    // Return full content; the host (e.g. Claude Code) manages context/token
    // limits and persists oversized results — server-side char truncation would
    // only corrupt large query results and docs mid-structure.
    return {
      content: array.map((text) => ({ type: "text" as const, text })),
    };
  }
  return response;
}
