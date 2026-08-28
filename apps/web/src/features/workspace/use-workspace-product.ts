import { useRef, useState } from "react";
import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type SessionListEntry,
  type TokenCostUpdate,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  EMPTY_WORKSPACE_PRODUCT,
  mergeTokenCost,
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

export interface WorkspaceProductController {
  state: WorkspaceProductState;
  reset: () => void;
  configureCapabilities: (
    capabilities: UiProtocolCapabilities | undefined,
  ) => void;
  refresh: (client?: OctosUiClient | null) => Promise<void>;
  listWorkspaceSessions: (cwd: string) => Promise<SessionListEntry[]>;
  deleteSession: (sessionId: string) => Promise<void>;
  setError: (message: string | null) => void;
  observeTokenCost: (update: TokenCostUpdate) => void;
}

/** Owns the server-backed workspace list independently of session transport. */
export function useWorkspaceProduct(
  dependencies: WorkspaceProductDependencies,
): WorkspaceProductController {
  const deletingSessionRef = useRef<string | null>(null);
  const [state, setState] = useState<WorkspaceProductState>(
    EMPTY_WORKSPACE_PRODUCT,
  );

  const reset = () => {
    deletingSessionRef.current = null;
    setState(EMPTY_WORKSPACE_PRODUCT);
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    setState((current) => ({
      ...current,
      // Core rc.9 advertises session/list and cwd requests, but its response
      // does not report the effective Workspace or Profile scope. An
      // advertised method is therefore not an authoritative product catalog.
      sessionsAvailable: false,
      deleteAvailable: supportsMethod(
        capabilities,
        CORE_UI_METHODS.SESSION_DELETE,
      ),
      // The workspace catalog is deliberately backed by one authoritative
      // request. Files and task activity are session-scoped views, not catalog
      // discovery, and must not add N+1 work or poison the session list.
      filesAvailable: false,
      filesLoading: false,
      files: [],
      activityAvailable: false,
      activityLoading: false,
      activityBySession: {},
      activityTasksBySession: {},
      activityUpdatedAt: null,
    }));
  };

  const refresh = async (_requestedClient = dependencies.client()) => {
    // Keep the current Session projection separate from catalog discovery.
    // App.tsx derives it from the successfully opened Session authority. Do
    // not call the legacy list method: rc.9 can silently ignore cwd and route
    // an admin connection through `_main`, while returning no scope proof.
    setState((current) => ({
      ...current,
      sessionsAvailable: false,
      loading: false,
      sessions: [],
      error: null,
    }));
  };

  const deleteSession = async (sessionId: string) => {
    const client = dependencies.client();
    if (
      !client ||
      sessionId === dependencies.sessionId() ||
      !supportsMethod(
        dependencies.capabilities(),
        CORE_UI_METHODS.SESSION_DELETE,
      ) ||
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

  const listWorkspaceSessions = async (
    requestedCwd: string,
  ): Promise<SessionListEntry[]> => {
    const cwd = requestedCwd.trim();
    if (!dependencies.client() || !cwd) {
      throw new Error("The Octos server connection is not ready.");
    }
    // This remains as the adapter seam for a future server-owned
    // Workspace/SessionRef catalog. The current list result contains only
    // rows, so accepting it here would assign unproven Sessions to `cwd`.
    throw new Error("Session history is not available for this workspace.");
  };

  return {
    state,
    reset,
    configureCapabilities,
    refresh,
    listWorkspaceSessions,
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
