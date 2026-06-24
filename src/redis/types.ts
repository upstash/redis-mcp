/** Result of a single command in a batch, aligned by index with the input. */
export type CommandResult =
  | { command: string[]; result: unknown }
  | { command: string[]; error: string };

export function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
