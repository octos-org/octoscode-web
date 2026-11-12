import { useEffect, useState } from "react";
import type {
  OctosUiClient,
  SessionListResult,
} from "@octos-org/octoscode-client/protocol";
import { isFullSessionForProfile } from "../resume/resume-binding.ts";
import type { WorkspaceCatalogSession } from "../session/workspace-session-catalog.ts";
import { errorMessage } from "../../shared/errors.ts";

/**
 * The profile's chats, read through `session/list { work_mode: "chat" }`.
 * Each row keeps the workspace the server gave that chat, so opening it goes
 * through the ordinary session/open path with that root. `off` until the
 * server has attested a chat listing; an unattested list is never shown as
 * chats.
 */
export interface ChatCatalogState {
  readonly status: "off" | "loaded" | "error";
  readonly sessions: readonly WorkspaceCatalogSession[];
  readonly error?: string;
}

const OFF: ChatCatalogState = { status: "off", sessions: [] };

export function chatSessionsFromList(
  profileId: string,
  result: SessionListResult,
): WorkspaceCatalogSession[] | null {
  if (result.work_mode !== "chat" || result.profile_id !== profileId)
    return null;
  const rows: WorkspaceCatalogSession[] = [];
  for (const entry of result.sessions) {
    if (
      entry.work_mode !== "chat" ||
      !entry.workspace_root ||
      !isFullSessionForProfile(entry.id, profileId)
    )
      continue;
    const updatedAt = entry.updated_at ? Date.parse(entry.updated_at) : NaN;
    rows.push({
      sessionId: entry.id,
      profileId,
      workspaceRoot: entry.workspace_root,
      title: entry.title?.trim() || null,
      lastPrompt: entry.last_prompt?.trim() || null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : null,
    });
  }
  return rows;
}

export function useChatSessionCatalog(options: {
  client: OctosUiClient | null;
  profileId: string;
  enabled: boolean;
  /** Any change re-lists (e.g. the active session or a finished turn). */
  refreshKey: string;
}): ChatCatalogState {
  const { client, profileId, enabled, refreshKey } = options;
  const [state, setState] = useState<ChatCatalogState>(OFF);
  useEffect(() => {
    if (!client || !profileId || !enabled) {
      setState(OFF);
      return;
    }
    let current = true;
    client
      .listSessions({ work_mode: "chat", profile_id: profileId })
      .then((result) => {
        if (!current) return;
        const sessions = chatSessionsFromList(profileId, result);
        setState(sessions ? { status: "loaded", sessions } : OFF);
      })
      .catch((reason: unknown) => {
        if (!current) return;
        // Keep the last attested rows; the list says it could not refresh.
        setState((previous) => ({
          status: previous.status === "off" ? "off" : "error",
          sessions: previous.sessions,
          error: errorMessage(reason),
        }));
      });
    return () => {
      current = false;
    };
  }, [client, profileId, enabled, refreshKey]);
  return state;
}
