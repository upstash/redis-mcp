import type { ZodSchema } from "zod";
import type { CustomTool } from "../tool";

function replacer(_key: string, value: unknown) {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return value;
}

export const json = (value: unknown) =>
  typeof value === "string" ? value : JSON.stringify(value, replacer, 2);

export function tool<TSchema extends ZodSchema>(t: CustomTool<TSchema>): CustomTool {
  return t as unknown as CustomTool;
}
