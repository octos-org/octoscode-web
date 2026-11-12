import {
  CHAT_WORKSPACE_UI_FEATURE,
  SESSION_WORK_MODE_UI_FEATURE,
  supportsFeature,
  type UiProtocolCapabilities,
  type WorkMode,
} from "@octos-org/octoscode-client/protocol";
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
