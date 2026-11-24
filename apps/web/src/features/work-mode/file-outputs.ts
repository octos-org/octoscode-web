import type { PermissionProfileSelection } from "@octos-org/octoscode-client/protocol";
import type { PermissionTransition } from "../review/permission-transitions.ts";

/**
 * T-E (two-modes proposal §6): a chat drafts inline until the user explicitly
 * allows file outputs. "On" is one exact server-reported permission for the
 * OPEN Session — `workspace_write` with the network still denied — read back
 * from the server after it applied the change. Anything else is not "on".
 *
 * The state is derived ONLY from the server's own permission readback: never
 * from a local toggle, never from a request that was merely sent. A set that
 * timed out or failed leaves the server state as the truth (re-read it).
 */
export type ChatFileOutputsState =
  /** Server truth says read-only: answers stay inline. */
  | "off"
  /** Server truth says workspace_write with the network denied. */
  | "on"
  /** A set is in flight for this Session (server has not answered yet). */
  | "applying"
  /**
   * A set's outcome is unknown, or another tab is changing it: re-read the
   * server before anything else, never send it again (T-0666).
   */
  | "unconfirmed"
  /** danger_full_access or any other profile: out of the chat's scope. */
  | "managed"
  /** No server truth yet (still loading or never read). */
  | "unknown";

export interface ChatPermissionFacts {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  result: { current: PermissionProfileSelection } | null;
  /** The Session's permission change this tab has not confirmed yet. */
  transition?: PermissionTransition | null;
}

export function chatFileOutputsState(
  permission: ChatPermissionFacts,
): ChatFileOutputsState {
  if (permission.busy || permission.transition === "applying")
    return "applying";
  if (permission.transition) return "unconfirmed";
  const current = permission.result?.current;
  if (!current) return "unknown";
  if (current.mode === "read_only") return "off";
  if (current.mode === "workspace_write" && current.network === "deny")
    return "on";
  return "managed";
}

/**
 * The ONLY two updates the control may ever send through the real
 * `permission/profile/set` path. The network is always pinned to deny; no
 * full-access or other widening exists here.
 */
export const FILE_OUTPUTS_ENABLE: PermissionProfileSelection = {
  mode: "workspace_write",
  network: "deny",
} as const;
export const FILE_OUTPUTS_REVOKE: PermissionProfileSelection = {
  mode: "read_only",
  network: "deny",
} as const;
