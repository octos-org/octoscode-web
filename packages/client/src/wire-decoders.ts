import { isRecord } from "./rpc.ts";
import type { UiCursor } from "./types.ts";

/** Primitive, fail-closed decoders shared by the handwritten protocol edge. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

export function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function parseUiCursor(value: unknown): UiCursor | null {
  if (
    !isRecord(value) ||
    typeof value.stream !== "string" ||
    !isNonNegativeInteger(value.seq)
  ) {
    return null;
  }
  return { stream: value.stream, seq: value.seq };
}
