import { isRecord } from "./rpc.ts";
import type { SessionOpened, SessionOpenResult } from "./types.ts";
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
