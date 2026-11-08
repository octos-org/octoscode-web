import type {
  PermissionProfileSetParams,
  PermissionProfileSetResult,
} from "@octos-org/octoscode-client/protocol";
import type { StorageLike } from "../connection/preferences.ts";
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
  /** "applying" only while this page has a set in flight. */
  readonly phase: "applying" | "failed";
}

export type PermissionDefaultGates = Readonly<
  Record<string, PermissionDefaultGate>
>;

const GATES_KEY = "octoscode-web.permission-default-gates.v1";
const MAX_GATES = 32;

/** Whether `sessionId` is the Session opened from the fresh `launchId`. */
export function openedFromLaunch(sessionId: string, launchId: string): boolean {
  return sessionId === launchId || sessionId.endsWith(`:api:${launchId}`);
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
 * A stored gate always loads as failed: a set that was in flight when the
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
    const { mode, network } = (value ?? {}) as Record<string, unknown>;
    if (isDefaultsPermissionMode(mode) && isDefaultsNetworkPolicy(network))
      gates[sessionId] = { mode, network, phase: "failed" };
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
            entries.map(([id, { mode, network }]) => [id, { mode, network }]),
          ),
        ),
      );
  } catch {
    // Storage is best effort; the in-memory gate still blocks this page.
  }
}
