import {
  OctosUiProtocolError,
  isRecord,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  catalogSessionsFromList,
  supportsWorkspaceSessionCatalog,
} from "./workspace-session-catalog.ts";

export interface ExistingWorkspaceSession {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly profileId: string;
}

function isAuthorizationRefusal(reason: unknown): boolean {
  if (!(reason instanceof OctosUiProtocolError)) return false;
  if (reason.code === -32003) return true;
  return (
    isRecord(reason.data) &&
    (reason.data.kind === "auth_scope_violation" ||
      reason.data.kind === "permission_denied")
  );
}

/**
 * Look up the newest existing canonical Session for an authorized
 * `(cwd, profileId)` pair BEFORE calling `session/open`, so a fresh browser
 * opening a known project recovers its history instead of minting an empty
 * session first. Never widens profile/scope and never trusts an unscoped list.
 */
export async function findExistingWorkspaceSession(
  client: Pick<OctosUiClient, "listSessions">,
  capabilities: UiProtocolCapabilities | undefined,
  cwd: string,
  profileId: string,
  isRetired: (sessionId: string) => boolean = () => false,
): Promise<ExistingWorkspaceSession | null> {
  const trimmedCwd = cwd.trim();
  const trimmedProfile = profileId.trim();
  if (
    !trimmedCwd ||
    !trimmedProfile ||
    !supportsWorkspaceSessionCatalog(capabilities)
  ) {
    return null;
  }
  let result;
  try {
    result = await client.listSessions({
      cwd: trimmedCwd,
      profile_id: trimmedProfile,
    });
  } catch (reason) {
    if (isAuthorizationRefusal(reason)) throw reason;
    return null;
  }
  if (!result.workspace_root || result.profile_id !== trimmedProfile) {
    return null;
  }
  const existing = catalogSessionsFromList(
    result.workspace_root,
    trimmedProfile,
    result.sessions,
  ).filter((row) => !isRetired(row.sessionId));
  const latest = existing[0];
  if (!latest) return null;
  return {
    sessionId: latest.sessionId,
    workspaceRoot: result.workspace_root,
    profileId: trimmedProfile,
  };
}
