import type { DatabaseConfig } from "../config";
import { config } from "../config";
import { assertReadOnly } from "./readonly";
import { runHttp } from "./rest";
import { runTcp } from "./tcp";
import type { CommandResult } from "./types";

/**
 * Run a batch of commands against a resolved database, dispatching to the
 * right transport. Applies the read-only guard first when enabled.
 */
export async function execute(
  db: DatabaseConfig,
  commands: string[][],
  transaction: boolean
): Promise<CommandResult[]> {
  if (config.readonly) assertReadOnly(commands);
  return db.transport === "http"
    ? runHttp(db, commands, transaction)
    : runTcp(db, commands, transaction);
}
