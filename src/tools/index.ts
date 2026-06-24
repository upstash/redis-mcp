import type { CustomTool } from "../tool";
import { buildRunCommandsTool } from "./run-commands";
import { searchDocsTool } from "./search-docs";

/**
 * Build the tool set. Called after config is loaded because the run-commands
 * tool's input schema depends on the configured databases.
 */
export function getTools(): Record<string, CustomTool> {
  return {
    redis_run_commands: buildRunCommandsTool(),
    redis_search_docs: searchDocsTool,
  };
}
