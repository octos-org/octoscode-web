import { isRecord } from "./rpc.ts";
import type { OutputCursor } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProtocolUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function parseCursor(value: unknown): OutputCursor | null {
  return isRecord(value) && isU64(value.offset)
    ? { offset: value.offset }
    : null;
}

export function optionalString<Key extends string>(value: unknown, key: Key) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<Key, string>)
    : null;
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
