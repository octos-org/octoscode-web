import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  supportsMethod,
} from "@octos-org/octoscode-client/protocol";
import type {
  InspectionThreadGraph,
  InspectionTurnState,
  InspectionApprovalScopes,
} from "@octos-org/octoscode-client/inspection";
import type { InspectionBinding } from "./inspection-binding.ts";
import type { InspectionRequest } from "./intent.ts";

export type InspectionResult =
  | { kind: "threads"; value: InspectionThreadGraph }
  | { kind: "approval-scopes"; value: InspectionApprovalScopes }
  | { kind: "turn"; value: InspectionTurnState };
export interface InspectionSnapshot {
  phase: "idle" | "loading" | "ready" | "error" | "retired";
  result: InspectionResult | null;
  error: string | null;
}

/** Read-only, single-view state. It has no queue, selection, or hydrate writes. */
export function createInspectionController(binding: InspectionBinding) {
  let snapshot: InspectionSnapshot = {
    phase: "idle",
    result: null,
    error: null,
  };
  const listeners = new Set<() => void>();
  let unsubscribe: (() => void) | undefined;
  let operation = 0;
  let pending: { key: string; promise: Promise<void> } | undefined;
  let retired = false;
  const publish = (next: InspectionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const check = () => {
    if (retired) return false;
    if (binding.isCurrent()) return true;
    retired = true;
    operation += 1;
    pending = undefined;
    publish({
      phase: "retired",
      result: null,
      error: "Inspection Session authority changed. Reopen the inspector.",
    });
    return false;
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      unsubscribe ??= binding.subscribe(check);
      check();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          unsubscribe?.();
          unsubscribe = undefined;
        }
      };
    },
    cancel() {
      operation += 1;
      pending = undefined;
      snapshot = { phase: "idle", result: null, error: null };
    },
    load(request: InspectionRequest): Promise<void> {
      if (!check()) return Promise.resolve();
      const key = JSON.stringify(request);
      if (pending?.key === key) return pending.promise;
      const ticket = ++operation;
      const captured = { ...request };
      const current = () => ticket === operation && check();
      const isThreads = captured.kind === "threads";
      const feature = isThreads
        ? CORE_UI_FEATURES.THREAD_GRAPH_V1
        : captured.kind === "turn"
          ? CORE_UI_FEATURES.TURN_STATE_GET_V1
          : null;
      const method = isThreads
        ? CORE_UI_METHODS.THREAD_GRAPH_GET
        : captured.kind === "turn"
          ? CORE_UI_METHODS.TURN_STATE_GET
          : CORE_UI_METHODS.APPROVAL_SCOPES_LIST;
      if (
        !supportsMethod(binding.capabilities, method) ||
        (feature !== null && !supportsFeature(binding.capabilities, feature))
      ) {
        publish({
          phase: "error",
          result: null,
          error:
            "This server does not advertise the required inspection method and feature.",
        });
        return Promise.resolve();
      }
      publish({ phase: "loading", result: null, error: null });
      const promise = (async () => {
        try {
          const commands = await binding.commands();
          if (!current()) return;
          if (
            commands.scope.sessionId !== binding.scope.sessionId ||
            commands.scope.profileId !== binding.scope.profileId
          )
            throw new Error("Wrong inspection owner");
          const result: InspectionResult =
            captured.kind === "threads"
              ? { kind: "threads", value: await commands.readThreadGraph() }
              : captured.kind === "turn"
                ? {
                    kind: "turn",
                    value: await commands.readTurnState(captured.turnId),
                  }
                : {
                    kind: "approval-scopes",
                    value: await commands.readApprovalScopes(),
                  };
          if (!current()) return;
          publish({ phase: "ready", result, error: null });
        } catch {
          if (!current()) return;
          // RPC error text may echo provider/configuration material. Display a
          // bounded static retry state, not arbitrary remote error objects.
          publish({
            phase: "error",
            result: null,
            error:
              "The server could not return a valid inspection for this owner. Retry the read.",
          });
        } finally {
          if (ticket === operation) pending = undefined;
        }
      })();
      pending = { key, promise };
      return promise;
    },
  };
}
