import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { AutonomyStore, type MonitorInput } from "./store.ts";
import { AUTONOMY_UNSUPPORTED } from "./client-contract.ts";
import type {
  AutonomyCapabilities,
  AgentArtifactSelector,
  RpcNotification,
  SessionAutonomyCommands,
} from "./client-contract.ts";
import type { AutonomyRuntimeState } from "./model.ts";
import type { LoopCreationInput } from "./loop-creation.ts";

export interface AutonomyDependencies {
  /**
   * Root's stable session-scoped command factory result
   * (`client.autonomyCommands(sessionId, capabilities)`), or null while the
   * session is closed / autonomy not negotiated. Identity matters: a new
   * object (re-auth, reconnect, re-resolution) starts a new authority epoch
   * and every in-flight result from the previous epoch is dropped — even
   * for the same session id.
   */
  commands: () => SessionAutonomyCommands | null;
  sessionId: () => string | null;
  isCurrent?: () => boolean;
}

export type { MonitorInput };
export type { LoopAction, MonitorAction } from "./store.ts";

export interface AutonomyController {
  state: AutonomyRuntimeState;
  capabilities: AutonomyCapabilities;
  /** Owning session this controller is bound to (root mounts keyed by it). */
  sessionId: string | null;
  isMutationPending: () => boolean;
  refresh: () => Promise<void>;
  setGoal: (objective: string, tokenBudget?: number) => Promise<boolean>;
  clearGoal: () => Promise<boolean>;
  transitionGoal: (action: "pause" | "resume" | "stop") => Promise<boolean>;
  createLoop: (
    input: string | LoopCreationInput,
    intervalSeconds?: number,
  ) => Promise<boolean>;
  controlLoop: (
    loopId: string,
    action: "pause" | "resume" | "delete" | "fire_now",
  ) => Promise<boolean>;
  createMonitor: (input: MonitorInput) => Promise<boolean>;
  controlMonitor: (
    monitorId: string,
    action: "pause" | "resume" | "delete",
  ) => Promise<boolean>;
  readAgentOutput: (agentId: string, loadMore?: boolean) => Promise<boolean>;
  readAgentStatus: (agentId: string) => Promise<boolean>;
  listAgentArtifacts: (agentId: string) => Promise<boolean>;
  readAgentArtifact: (
    agentId: string,
    selector: AgentArtifactSelector,
  ) => Promise<boolean>;
  controlAgent: (
    agentId: string,
    action: "interrupt" | "close",
  ) => Promise<boolean>;
  /** Feed an incoming protocol notification into the engine. */
  observeNotification: (notification: RpcNotification) => void;
}

/**
 * Thin React binding over {@link AutonomyStore}. Every ordering invariant —
 * per-operation gates, commands-identity authority epoch, refresh revision
 * guard, #1959 goal-generation admission, session binding — lives in the
 * store, where it is unit-testable without a renderer. The hook only owns
 * the subscription and a stable delegate surface for the panel.
 */
export function useAutonomy(
  dependencies: AutonomyDependencies,
): AutonomyController {
  const storeRef = useRef<AutonomyStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new AutonomyStore(dependencies);
  }
  const store = storeRef.current;
  store.setDeps(dependencies);
  useEffect(() => {
    store.resume();
    return store.suspend;
  }, [store]);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    // Server rendering (vite SSR / static tests) needs the same snapshot.
    store.getState,
  );

  // Fail closed: no commands (session closed / autonomy not negotiated) means
  // NO actionable capabilities — never a fallback to previously seen caps.
  const injectedCapabilities =
    dependencies.commands()?.capabilities ?? AUTONOMY_UNSUPPORTED;
  const epoch = store.authorityEpoch;
  // Stable for this authority, not for this render/state snapshot. A queued
  // callback from an old subscription always retains its OLD epoch.
  const observeNotification = useMemo(
    () => (notification: RpcNotification) =>
      store.observeNotification(notification, epoch),
    [store, epoch],
  );

  return useMemo(
    () => ({
      state,
      capabilities: injectedCapabilities,
      sessionId: store.sessionId,
      isMutationPending: store.isMutationPending,
      refresh: () => store.refresh(),
      setGoal: (objective, tokenBudget) =>
        store.setGoal(objective, tokenBudget),
      clearGoal: () => store.clearGoal(),
      transitionGoal: (action) => store.transitionGoal(action),
      createLoop: (prompt, intervalSeconds) =>
        store.createLoop(prompt, intervalSeconds),
      controlLoop: (loopId, action) => store.controlLoop(loopId, action),
      createMonitor: (input) => store.createMonitor(input),
      controlMonitor: (monitorId, action) =>
        store.controlMonitor(monitorId, action),
      readAgentOutput: (agentId, loadMore) =>
        store.readAgentOutput(agentId, loadMore),
      readAgentStatus: (agentId) => store.readAgentStatus(agentId),
      listAgentArtifacts: (agentId) => store.listAgentArtifacts(agentId),
      readAgentArtifact: (agentId, selector) =>
        store.readAgentArtifact(agentId, selector),
      controlAgent: (agentId, action) => store.controlAgent(agentId, action),
      observeNotification,
    }),
    [state, store, injectedCapabilities, observeNotification],
  );
}
