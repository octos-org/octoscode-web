import {
  CHAT_WORKSPACE_UI_FEATURE,
  SESSION_WORK_MODE_UI_FEATURE,
  supportsFeature,
  type UiProtocolCapabilities,
  type WorkMode,
} from "@octos-org/octoscode-client/protocol";
import type { StorageLike } from "../connection/preferences.ts";
import type { UiLanguage } from "../preferences/model.ts";
import type { SessionDefaults } from "../session-config/session-defaults.ts";

/**
 * Chat / Code navigation stays off until Core can keep chats apart (two-modes
 * proposal T-A and T-B). Until then one browser opts in by setting this key to
 * "on"; even then Chat only opens on a server that negotiates both features.
 */
export const TWO_MODES_FLAG_KEY = "octoscode-web.two-modes";

export function twoModesFlagOn(): boolean {
  try {
    return window.localStorage.getItem(TWO_MODES_FLAG_KEY) === "on";
  } catch {
    return false;
  }
}

/**
 * Chat needs both the durable mode and a workspace of its own per chat: a
 * chat in a shared folder would not be the chat the switch promises.
 */
export function chatModeSupported(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return (
    supportsFeature(capabilities, SESSION_WORK_MODE_UI_FEATURE) &&
    supportsFeature(capabilities, CHAT_WORKSPACE_UI_FEATURE)
  );
}

export interface ModeSelections {
  readonly chat: string | null;
  readonly code: string | null;
}

const MODE_SELECTIONS_KEY = "octoscode-web.mode-selections.v1";
const MAX_SELECTION_KEY = 8_192;

/**
 * Each mode's last selection survives a reload of this tab (T-0668: a chat
 * reloaded, then Code came back to its home). Tab-scoped like the tab's own
 * Session reference, and per server: another tab starts with its own, and the
 * keys name Sessions only, never a credential.
 */
export function loadModeSelections(
  storage: StorageLike,
  endpoint: string,
): ModeSelections {
  try {
    const saved: unknown = JSON.parse(
      storage.getItem(MODE_SELECTIONS_KEY) ?? "null",
    );
    if (
      typeof saved !== "object" ||
      saved === null ||
      (saved as { endpoint?: unknown }).endpoint !== endpoint
    )
      return NO_SELECTIONS;
    const read = (mode: WorkMode) => {
      const key = (saved as Partial<Record<WorkMode, unknown>>)[mode];
      return typeof key === "string" &&
        key.length <= MAX_SELECTION_KEY &&
        selectionScope(key)
        ? key
        : null;
    };
    return { chat: read("chat"), code: read("code") };
  } catch {
    return NO_SELECTIONS;
  }
}

export function saveModeSelections(
  storage: StorageLike,
  endpoint: string,
  selections: ModeSelections,
): void {
  try {
    if (!selections.chat && !selections.code)
      storage.removeItem(MODE_SELECTIONS_KEY);
    else
      storage.setItem(
        MODE_SELECTIONS_KEY,
        JSON.stringify({ endpoint, ...selections }),
      );
  } catch {
    // Storage full or denied: the selections still hold for this page load.
  }
}

export const NO_SELECTIONS: ModeSelections = { chat: null, code: null };

/** A remembered key's workspace, profile and Session id, or null if malformed. */
export function selectionScope(
  key: string,
): { workspaceRoot: string; profileId: string; sessionId: string } | null {
  try {
    const parts: unknown = JSON.parse(key);
    return Array.isArray(parts) &&
      parts.length === 3 &&
      parts.every((part) => typeof part === "string" && part)
      ? {
          workspaceRoot: parts[0] as string,
          profileId: parts[1] as string,
          sessionId: parts[2] as string,
        }
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether switching back can reopen a mode's remembered Session. `listed` is
 * the server's listing that would hold it, fetched after the switch, or null
 * while that listing is on its way. "gone" (deleted, hidden, another profile)
 * opens nothing: reopening an id the server no longer lists could start an
 * empty Session under it, and another Session is never put in its place.
 */
export function modeRestoreVerdict(
  key: string,
  listed:
    | readonly { workspaceRoot: string; profileId: string; sessionId: string }[]
    | null,
  profileId: string,
): "open" | "gone" | "wait" {
  const scope = selectionScope(key);
  if (!scope || scope.profileId !== profileId) return "gone";
  if (listed === null) return "wait";
  return listed.some(
    (row) =>
      row.workspaceRoot === scope.workspaceRoot &&
      row.profileId === scope.profileId &&
      row.sessionId === scope.sessionId,
  )
    ? "open"
    : "gone";
}

/** What each mode had selected last, so switching back returns to it. */
export function rememberSelection(
  selections: ModeSelections,
  mode: WorkMode,
  sessionKey: string | null,
): ModeSelections {
  return sessionKey === null || selections[mode] === sessionKey
    ? selections
    : { ...selections, [mode]: sessionKey };
}

/**
 * The modes are named 对话 / 编码 in Chinese (two-modes proposal §9). The
 * shared catalog already translates "Chat" as 聊天 for the transcript tab, and
 * keys are the English text, so the mode names keep their own table.
 */
export const WORK_MODE_NAMES: Readonly<
  Record<UiLanguage, Readonly<Record<WorkMode, string>>>
> = {
  en: { chat: "Chat", code: "Code" },
  zh: { chat: "对话", code: "编码" },
};

/**
 * Every new chat starts read-only with no network (proposal §4.3). The web
 * asks the server for it through the new-session permission gate, so the chat
 * sends nothing until the server confirms it is in effect.
 */
export const CHAT_PERMISSION_DEFAULTS: SessionDefaults = {
  permissionMode: "read_only",
  network: "deny",
  sandbox: { enabled: false, networkAccess: false, readAllowPaths: [] },
};
