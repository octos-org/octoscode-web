import { isRecord } from "./rpc.ts";
import type { OutputCursor } from "./types.ts";
export function parseCursor(value: unknown): OutputCursor | null {
  return isRecord(value) && isU64(value.offset)
    ? { offset: value.offset }
    : null;
}

export function copyOptionalStrings<const Keys extends readonly string[]>(
  value: Record<string, unknown>,
  keys: Keys,
): Partial<Record<Keys[number], string>> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      typeof value[key] === "string" ? [[key, value[key]]] : [],
    ),
  ) as Partial<Record<Keys[number], string>>;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isU32(value: unknown): value is number {
  return (
    Number.isInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= 4_294_967_295
  );
}

export function isU64(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}
