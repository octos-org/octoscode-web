import { useEffect, useRef, useState } from "react";
import {
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type TokenCostUpdate,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  EMPTY_WORKSPACE_PRODUCT,
  includeActiveSession,
  mergeTokenCost,
  sortSessions,
  summarizeSessionTasks,
  type SessionActivitySummary,
  type WorkspaceProductState,
} from "./model.ts";

interface WorkspaceConnectionConfig {
  cwd: string;
}

interface WorkspaceProductDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
  connectionConfig: () => WorkspaceConnectionConfig | null;
}

const BACKGROUND_ACTIVITY_LIMIT = 20;
const BACKGROUND_ACTIVITY_POLL_MS = 10_000;
const BACKGROUND_ACTIVITY_CONCURRENCY = 4;

export interface WorkspaceProductController {
  state: WorkspaceProductState;
  reset: () => void;
  configureCapabilities: (
    capabilities: UiProtocolCapabilities | undefined,
  ) => void;
  refresh: (client?: OctosUiClient | null) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  setError: (message: string) => void;
  observeTokenCost: (update: TokenCostUpdate) => void;
}

/** Owns the server-backed workspace list independently of session transport. */
export function useWorkspaceProduct(
  dependencies: WorkspaceProductDependencies,
): WorkspaceProductController {
  const requestRef = useRef(0);
  const activityRequestRef = useRef(0);
  const deletingSessionRef = useRef<string | null>(null);
  const [state, setState] = useState<WorkspaceProductState>(
    EMPTY_WORKSPACE_PRODUCT,
  );
  const dependenciesRef = useRef(dependencies);
  const sessionsRef = useRef(state.sessions);
  dependenciesRef.current = dependencies;
  sessionsRef.current = state.sessions;

  useEffect(() => {
    const timer = setInterval(() => {
      if (
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      ) {
        void refreshActivity();
      }
    }, BACKGROUND_ACTIVITY_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  const reset = () => {
    requestRef.current += 1;
    activityRequestRef.current += 1;
    deletingSessionRef.current = null;
    setState(EMPTY_WORKSPACE_PRODUCT);
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    setState((current) => ({
      ...current,
      sessionsAvailable: supportsMethod(capabilities, "session/list"),
      deleteAvailable: supportsMethod(capabilities, "session/delete"),
      filesAvailable: supportsMethod(capabilities, "session/files.list"),
      activityAvailable: supportsMethod(capabilities, "task/list"),
    }));
  };

  const refresh = async (requestedClient = dependencies.client()) => {
    const sessionId = dependencies.sessionId();
    const config = dependencies.connectionConfig();
    const capabilities = dependencies.capabilities();
    if (!requestedClient || !sessionId || !config) return;
    const canList = supportsMethod(capabilities, "session/list");
    const canListFiles = supportsMethod(capabilities, "session/files.list");
    if (!canList && !canListFiles) return;
    const request = requestRef.current + 1;
    requestRef.current = request;
    setState((current) => ({
      ...current,
      loading: canList,
      filesLoading: canListFiles,
      error: null,
    }));
    const [sessions, files] = await Promise.allSettled([
      canList
        ? requestedClient.listSessions(
            config.cwd &&
              supportsFeature(capabilities, "session.workspace_cwd.v1")
              ? { cwd: config.cwd }
              : {},
          )
        : Promise.resolve(null),
      canListFiles
        ? requestedClient.listSessionFiles({ session_id: sessionId })
        : Promise.resolve(null),
    ]);
    if (
      dependencies.client() !== requestedClient ||
      dependencies.sessionId() !== sessionId ||
      requestRef.current !== request
    ) {
      return;
    }
    const errors: string[] = [];
    if (sessions.status === "rejected") {
      errors.push(errorMessage(sessions.reason));
    }
    if (files.status === "rejected") {
      errors.push(errorMessage(files.reason));
    }
    const nextSessions =
      sessions.status === "fulfilled" && sessions.value
        ? includeActiveSession(sortSessions(sessions.value.sessions), sessionId)
        : null;
    setState((current) => ({
      ...current,
      loading: false,
      filesLoading: false,
      sessions: nextSessions ?? current.sessions,
      files:
        files.status === "fulfilled" && files.value
          ? files.value.files
          : current.files,
      error: errors.length ? errors.join(" · ") : null,
    }));
    if (nextSessions) {
      sessionsRef.current = nextSessions;
      await refreshActivity(requestedClient, nextSessions);
    }
  };

  async function refreshActivity(
    requestedClient = dependenciesRef.current.client(),
    requestedSessions = sessionsRef.current,
  ) {
    const currentDependencies = dependenciesRef.current;
    const activeSessionId = currentDependencies.sessionId();
    if (
      !requestedClient ||
      !activeSessionId ||
      !supportsMethod(currentDependencies.capabilities(), "task/list") ||
      requestedSessions.length === 0
    ) {
      return;
    }
    const request = activityRequestRef.current + 1;
    activityRequestRef.current = request;
    const targets = requestedSessions.slice(0, BACKGROUND_ACTIVITY_LIMIT);
    setState((current) => ({ ...current, activityLoading: true }));
    const entries = await mapWithConcurrency(
      targets,
      BACKGROUND_ACTIVITY_CONCURRENCY,
      async (session) => {
        try {
          const result = await requestedClient.listTasks({
            session_id: session.id,
          });
          if (result.session_id !== session.id) {
            throw new Error("task/list returned another session");
          }
          return [session.id, summarizeSessionTasks(result.tasks)] as const;
        } catch (reason) {
          const summary: SessionActivitySummary = {
            status: "unknown",
            taskCount: 0,
            runningCount: 0,
            failedCount: 0,
            completedCount: 0,
            error: errorMessage(reason),
          };
          return [session.id, summary] as const;
        }
      },
    );
    if (
      dependenciesRef.current.client() !== requestedClient ||
      dependenciesRef.current.sessionId() !== activeSessionId ||
      activityRequestRef.current !== request
    ) {
      return;
    }
    setState((current) => ({
      ...current,
      activityLoading: false,
      activityBySession: Object.fromEntries(entries),
      activityUpdatedAt: Date.now(),
    }));
  }

  const deleteSession = async (sessionId: string) => {
    const client = dependencies.client();
    if (
      !client ||
      sessionId === dependencies.sessionId() ||
      !supportsMethod(dependencies.capabilities(), "session/delete") ||
      deletingSessionRef.current
    ) {
      return;
    }
    deletingSessionRef.current = sessionId;
    setState((current) => ({
      ...current,
      deletingSessionId: sessionId,
      error: null,
    }));
    try {
      await client.deleteSession({ session_id: sessionId });
      if (dependencies.client() !== client) return;
      setState((current) => ({
        ...current,
        deletingSessionId: null,
        sessions: current.sessions.filter(
          (session) => session.id !== sessionId,
        ),
      }));
    } catch (reason) {
      if (dependencies.client() !== client) return;
      setState((current) => ({
        ...current,
        deletingSessionId: null,
        error: errorMessage(reason),
      }));
    } finally {
      if (deletingSessionRef.current === sessionId) {
        deletingSessionRef.current = null;
      }
    }
  };

  return {
    state,
    reset,
    configureCapabilities,
    refresh,
    deleteSession,
    setError: (message) =>
      setState((current) => ({ ...current, error: message })),
    observeTokenCost: (update) =>
      setState((current) => ({
        ...current,
        tokenCost: mergeTokenCost(current.tokenCost, update),
      })),
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  map: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output: Output[] = [];
  for (let offset = 0; offset < values.length; offset += concurrency) {
    const batch = await Promise.all(
      values.slice(offset, offset + concurrency).map(map),
    );
    output.push(...batch);
  }
  return output;
}
