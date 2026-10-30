import { isRecord } from "./rpc.ts";
import type {
  SessionFileReadResult,
  SessionOpened,
  SessionOpenResult,
} from "./types.ts";
import { parseUiProtocolCapabilities } from "./workspace.ts";
import { isNonEmptyString, parseUiCursor } from "./wire-decoders.ts";

export function parseSessionOpenResult(
  value: unknown,
): SessionOpenResult | null {
  if (!isRecord(value)) return null;
  const opened = parseSessionOpened(value.opened);
  return opened ? { opened } : null;
}

function parseSessionOpened(value: unknown): SessionOpened | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    (value.active_profile_id !== undefined &&
      !isNonEmptyString(value.active_profile_id)) ||
    (value.workspace_root !== undefined &&
      typeof value.workspace_root !== "string") ||
    (value.reasoning_effort !== undefined &&
      value.reasoning_effort !== null &&
      typeof value.reasoning_effort !== "string")
  ) {
    return null;
  }
  const cursor =
    value.cursor === undefined ? undefined : parseUiCursor(value.cursor);
  const capabilities =
    value.capabilities === undefined
      ? undefined
      : parseUiProtocolCapabilities(value.capabilities);
  if (cursor === null || capabilities === null) return null;
  return {
    session_id: value.session_id,
    ...(typeof value.active_profile_id === "string"
      ? { active_profile_id: value.active_profile_id }
      : {}),
    ...(cursor ? { cursor } : {}),
    ...(capabilities ? { capabilities } : {}),
    ...(typeof value.workspace_root === "string"
      ? { workspace_root: value.workspace_root }
      : {}),
    ...(value.panes === undefined ? {} : { panes: value.panes }),
    ...(value.reasoning_effort === undefined
      ? {}
      : { reasoning_effort: value.reasoning_effort }),
  };
}

export function parseSessionFileReadResult(
  value: unknown,
): SessionFileReadResult | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.session_id) ||
    !isNonEmptyString(value.path) ||
    typeof value.size_bytes !== "number" ||
    !Number.isSafeInteger(value.size_bytes) ||
    value.size_bytes < 0 ||
    typeof value.offset !== "number" ||
    !Number.isSafeInteger(value.offset) ||
    value.offset < 0 ||
    typeof value.eof !== "boolean" ||
    !isNonEmptyString(value.mime_type) ||
    value.encoding !== "base64" ||
    typeof value.content_base64 !== "string"
  ) {
    return null;
  }
  return {
    session_id: value.session_id,
    path: value.path,
    size_bytes: value.size_bytes,
    offset: value.offset,
    eof: value.eof,
    mime_type: value.mime_type,
    encoding: "base64",
    content_base64: value.content_base64,
  };
}
