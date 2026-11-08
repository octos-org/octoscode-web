import type {
  PermissionProfileSetParams,
  PermissionProfileSetResult,
} from "@octos-org/octoscode-client/protocol";
import type { StorageLike } from "../connection/preferences.ts";
import { bindWebSessionIdToProfile } from "../session/session-identity.ts";
import {
  isDefaultsNetworkPolicy,
  isDefaultsPermissionMode,
  type DefaultsNetworkPolicy,
  type DefaultsPermissionMode,
} from "./session-defaults.ts";

/**
 * A created Session's permission default fails closed. From the moment the
 * Session opens until the server confirms the default, nothing is sent in it.
 * A refusal, an unconfirmed reply or a missing connection stays on that
 * Session, with a retry, until the server confirms the default. The gates are
 * tab-scoped (sessionStorage) so a reload keeps them instead of quietly
 * sending under whatever permission the server gave the Session.
 */
export interface PermissionDefaultGate {
  readonly mode: DefaultsPermissionMode;
  readonly network: DefaultsNetworkPolicy;
  /**
   * "applying" only while this page has a set in flight. "other-profile": the
   * launch opened under an id not bound to its profile (another profile, or
   * the bare launch id on a server without launch/resolve), so the default is
   * never sent there; only the server reporting the default in effect lifts
   * the gate.
   */
  readonly phase: "applying" | "failed" | "other-profile";
}

export type PermissionDefaultGates = Readonly<
  Record<string, PermissionDefaultGate>
>;

const GATES_KEY = "octoscode-web.permission-default-gates.v1";
const MAX_GATES = 32;

/**
 * How an opened Session relates to the pending fresh launch. "exact" is the
 * launch id bound to the profile the server opened it under (#409) and the
 * only Session the default is sent to; the same launch id under any other
 * profile is "other-profile".
 */
export function launchMatch(
  opened: { readonly session_id: string; readonly active_profile_id?: string },
  launchId: string,
): "exact" | "other-profile" | "none" {
  const id = opened.session_id;
  if (
    id === bindWebSessionIdToProfile(launchId, opened.active_profile_id ?? "")
  )
    return "exact";
  return id === launchId || id.endsWith(`:api:${launchId}`)
    ? "other-profile"
    : "none";
}

/**
 * Set the default and resolve only when the server confirms it for exactly
 * this Session. No connection, an error, `applied: false` or a reply for
 * another Session all reject, so the gate stays.
 */
export async function confirmPermissionDefault(
  client: {
    setPermissionProfile(
      params: PermissionProfileSetParams,
    ): Promise<PermissionProfileSetResult>;
  } | null,
  sessionId: string,
  gate: Pick<PermissionDefaultGate, "mode" | "network">,
): Promise<void> {
  if (!client) throw new Error("No server connection.");
  const result = await client.setPermissionProfile({
    session_id: sessionId,
    update: { mode: gate.mode, network: gate.network },
  });
  if (!result.applied || result.session_id !== sessionId)
    throw new Error("The server did not apply the permission default.");
}

export function withoutPermissionDefaultGate(
  gates: PermissionDefaultGates,
  sessionId: string,
): PermissionDefaultGates {
  if (!(sessionId in gates)) return gates;
  const next = { ...gates };
  delete next[sessionId];
  return next;
}

/**
 * A stored "applying" gate loads as failed: a set that was in flight when the
 * page went away has no known outcome.
 */
export function loadPermissionDefaultGates(
  storage: StorageLike,
): PermissionDefaultGates {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(GATES_KEY) ?? "{}");
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null) return {};
  const gates: Record<string, PermissionDefaultGate> = {};
  for (const [sessionId, value] of Object.entries(parsed).slice(-MAX_GATES)) {
    const { mode, network, phase } = (value ?? {}) as Record<string, unknown>;
    if (isDefaultsPermissionMode(mode) && isDefaultsNetworkPolicy(network))
      gates[sessionId] = {
        mode,
        network,
        phase: phase === "other-profile" ? "other-profile" : "failed",
      };
  }
  return gates;
}

export function savePermissionDefaultGates(
  storage: StorageLike,
  gates: PermissionDefaultGates,
): void {
  const entries = Object.entries(gates).slice(-MAX_GATES);
  try {
    if (entries.length === 0) storage.removeItem(GATES_KEY);
    else
      storage.setItem(
        GATES_KEY,
        JSON.stringify(
          Object.fromEntries(
            entries.map(([id, { mode, network, phase }]) => [
              id,
              { mode, network, phase },
            ]),
          ),
        ),
      );
  } catch {
    // Storage is best effort; the in-memory gate still blocks this page.
  }
}
