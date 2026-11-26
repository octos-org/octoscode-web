import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  CORE_UI_METHODS,
  DIFF_WORKSPACE_GET,
  isPreviewId,
  notificationDiffPreviewId,
  supportsMethod,
  type DiffPreviewGetResult,
  type OctosUiClient,
  type PermissionProfileListResult,
  type PermissionProfileUpdate,
  type RpcNotification,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { RequestAuthorityGate } from "../async/request-authority.ts";
import type {
  PermissionTransition,
  PermissionTransitions,
} from "./permission-transitions.ts";
import { errorMessage } from "../../shared/errors.ts";
import type { SessionFileChange } from "../side-panel/session-changes.ts";

export interface PermissionRuntimeState {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  result: PermissionProfileListResult | null;
  error: string | null;
  /** The open Session's unconfirmed permission change: nothing dispatches. */
  transition: PermissionTransition | null;
}

type PermissionReadState = Omit<PermissionRuntimeState, "transition">;

export type DiffScope = "turn" | "workspace";

export interface DiffReviewRuntimeState {
  available: boolean;
  workspaceAvailable: boolean;
  scope: DiffScope;
  latestPreviewId: string | null;
  active: boolean;
  loading: boolean;
  result: DiffPreviewGetResult | null;
  error: string | null;
}

const EMPTY_PERMISSION: PermissionReadState = {
  available: false,
  editable: false,
  loading: false,
  busy: false,
  result: null,
  error: null,
};

const EMPTY_DIFF_REVIEW: DiffReviewRuntimeState = {
  available: false,
  workspaceAvailable: false,
  scope: "turn",
  latestPreviewId: null,
  active: false,
  loading: false,
  result: null,
  error: null,
};

interface CodingSafetyDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  profileId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
  onPermissionApplied: (client: OctosUiClient) => void;
  /** Per-Session dispatch gate every permission SET here goes through. */
  transitions: PermissionTransitions;
}

export function useCodingSafety(dependencies: CodingSafetyDependencies) {
  const diffRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const permissionRequestsRef = useRef(
    new RequestAuthorityGate<OctosUiClient>(),
  );
  const permissionMutationRef = useRef(
    new RequestAuthorityGate<OctosUiClient>(),
  );
  const permissionBusyRef = useRef(false);
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const [permission, setPermission] =
    useState<PermissionReadState>(EMPTY_PERMISSION);
  const transitions = dependencies.transitions;
  const transition = useSyncExternalStore(transitions.subscribe, () =>
    transitions.state(dependenciesRef.current.sessionId()),
  );
  const [diffReview, setDiffReview] =
    useState<DiffReviewRuntimeState>(EMPTY_DIFF_REVIEW);

  const reset = () => {
    permissionBusyRef.current = false;
    diffRequestsRef.current.invalidate();
    permissionRequestsRef.current.invalidate();
    permissionMutationRef.current.invalidate();
    setPermission(EMPTY_PERMISSION);
    setDiffReview(EMPTY_DIFF_REVIEW);
  };

  const cancelPending = () => {
    diffRequestsRef.current.invalidate();
    permissionRequestsRef.current.invalidate();
    setPermission((current) =>
      current.loading ? { ...current, loading: false } : current,
    );
    setDiffReview((current) =>
      current.loading ? { ...current, loading: false } : current,
    );
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    // Runtime hydrate/reconnect installs a new RPC authority. Old socket
    // requests may never settle, so invalidate them synchronously instead of
    // waiting for a stale finally block to unlock the new Session controls.
    diffRequestsRef.current.invalidate();
    permissionRequestsRef.current.invalidate();
    permissionMutationRef.current.invalidate();
    permissionBusyRef.current = false;
    const permissionAvailable = supportsMethod(
      capabilities,
      CORE_UI_METHODS.PERMISSION_PROFILE_LIST,
    );
    setPermission((current) => ({
      ...current,
      loading: false,
      busy: false,
      available: permissionAvailable,
      editable:
        permissionAvailable &&
        supportsMethod(capabilities, CORE_UI_METHODS.PERMISSION_PROFILE_SET),
    }));
    setDiffReview((current) => ({
      ...current,
      loading: false,
      available: supportsMethod(capabilities, CORE_UI_METHODS.DIFF_PREVIEW_GET),
      workspaceAvailable: supportsMethod(capabilities, DIFF_WORKSPACE_GET),
    }));
  };

  /** `explicit`: the user asked, so it may also settle an unknown change. */
  const refreshPermission = async (
    client = dependenciesRef.current.client(),
    explicit = false,
  ): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const sessionId = currentDependencies.sessionId();
    if (
      !client ||
      !sessionId ||
      permissionBusyRef.current ||
      !supportsMethod(
        currentDependencies.capabilities(),
        CORE_UI_METHODS.PERMISSION_PROFILE_LIST,
      )
    ) {
      return;
    }
    const request = permissionRequestsRef.current.begin(client, sessionId);
    const read = currentDependencies.transitions.beginRead(sessionId, explicit);
    setPermission((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await client.listPermissionProfiles({
        session_id: sessionId,
      });
      if (!requestIsCurrent()) return;
      if (result.session_id !== sessionId) {
        throw new Error("permission/profile/list returned another session");
      }
      setPermission((current) => ({ ...current, loading: false, result }));
      currentDependencies.transitions.completeRead(read);
    } catch (reason) {
      if (!requestIsCurrent()) return;
      setPermission((current) => ({
        ...current,
        loading: false,
        error: errorMessage(reason),
      }));
    } finally {
      if (permissionRequestsRef.current.finish(request)) {
        setPermission((current) =>
          current.loading ? { ...current, loading: false } : current,
        );
      }
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return permissionRequestsRef.current.isCurrent(
        request,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  /**
   * Run one permission SET behind the Session's dispatch gate (T-0666).
   * `apply` sends it and throws unless the receipt is the requested change,
   * applied, for this Session. Nothing dispatches in the Session until a read
   * started after that receipt lands; any other outcome keeps it closed until
   * the user re-reads. Resolves whether the change was confirmed.
   */
  const gatePermissionSet = async (
    client: OctosUiClient,
    sessionId: string,
    apply: () => Promise<void>,
  ): Promise<boolean> => {
    const ticket = transitions.begin(sessionId);
    try {
      await apply();
      transitions.verified(ticket);
      await refreshPermission(client);
      return !transitions.blocked(sessionId);
    } finally {
      transitions.settle(ticket);
    }
  };

  const updatePermission = async (
    update: PermissionProfileUpdate,
  ): Promise<boolean> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    if (
      !client ||
      !sessionId ||
      !permission.available ||
      !permission.editable ||
      permissionBusyRef.current ||
      // An unconfirmed change is re-read, never sent again on top.
      transitions.blocked(sessionId)
    ) {
      return false;
    }
    const current = permission.result?.current;
    const next = current
      ? {
          mode: update.mode ?? current.mode,
          network: update.network ?? current.network,
        }
      : null;
    if (
      !next ||
      !permission.result?.profiles.some(
        (profile) => profile.mode === next.mode,
      ) ||
      !permission.result?.profiles.some(
        (profile) => profile.network === next.network,
      )
    ) {
      setPermission((state) => ({
        ...state,
        error:
          "The requested permission profile was not advertised for this session",
      }));
      return false;
    }

    // A mutation supersedes any older permission read. Otherwise a slow list
    // response can overwrite the just-selected profile before the post-write
    // refresh begins.
    permissionRequestsRef.current.invalidate();
    const request = permissionMutationRef.current.begin(client, sessionId);
    permissionBusyRef.current = true;
    setPermission((state) => ({
      ...state,
      loading: false,
      busy: true,
      error: null,
    }));
    try {
      const confirmed = await gatePermissionSet(client, sessionId, async () => {
        const result = await client.setPermissionProfile({
          session_id: sessionId,
          update,
        });
        if (!requestIsCurrent())
          throw new Error("permission/profile/set lost its Session");
        if (result.session_id !== sessionId) {
          throw new Error("permission/profile/set returned another session");
        }
        if (!result.applied) {
          throw new Error("The server did not apply the permission change");
        }
        // Network deny is never widened behind the user's back either.
        if (
          result.current.mode !== next.mode ||
          result.current.network !== next.network
        ) {
          throw new Error(
            "The server applied a different permission than requested",
          );
        }
        setPermission((state) => ({
          ...state,
          busy: false,
          result: state.result
            ? { ...state.result, current: result.current }
            : {
                session_id: result.session_id,
                current: result.current,
                profiles: [],
              },
        }));
        permissionBusyRef.current = false;
      });
      if (!requestIsCurrent()) return false;
      if (confirmed) dependenciesRef.current.onPermissionApplied(client);
      return confirmed;
    } catch (reason) {
      if (!requestIsCurrent()) return false;
      setPermission((state) => ({
        ...state,
        error: errorMessage(reason),
      }));
      return false;
    } finally {
      if (permissionMutationRef.current.finish(request)) {
        permissionBusyRef.current = false;
        setPermission((current) =>
          current.busy ? { ...current, busy: false } : current,
        );
      }
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return permissionMutationRef.current.isCurrent(
        request,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  const openDiffReview = async (
    requestedPreviewId?: string,
    requestedScope?: DiffScope,
  ): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const previewId = requestedPreviewId ?? diffReview.latestPreviewId;
    const scope = requestedPreviewId
      ? "turn"
      : (requestedScope ??
        (diffReview.active
          ? diffReview.scope
          : previewId ||
              !supportsMethod(
                currentDependencies.capabilities(),
                DIFF_WORKSPACE_GET,
              )
            ? "turn"
            : "workspace"));
    if (!client || !sessionId) return;
    const method =
      scope === "workspace"
        ? DIFF_WORKSPACE_GET
        : CORE_UI_METHODS.DIFF_PREVIEW_GET;
    if (
      !supportsMethod(currentDependencies.capabilities(), method) ||
      (scope === "turn" && (!previewId || !isPreviewId(previewId)))
    ) {
      diffRequestsRef.current.invalidate();
      setDiffReview((current) => ({
        ...current,
        active: true,
        scope,
        loading: false,
        result: null,
        error: supportsMethod(currentDependencies.capabilities(), method)
          ? null
          : "This server does not support this changes view. Update Octos.",
      }));
      return;
    }

    const request = diffRequestsRef.current.begin(client, sessionId);
    setDiffReview((current) => ({
      ...current,
      latestPreviewId: scope === "turn" ? previewId : current.latestPreviewId,
      scope,
      active: true,
      loading: true,
      result: null,
      error: null,
    }));
    try {
      const result =
        scope === "workspace"
          ? await client.getWorkspaceDiff({
              session_id: sessionId,
              ...(currentDependencies.profileId()
                ? { profile_id: currentDependencies.profileId() }
                : {}),
            })
          : await client.getDiffPreview({
              session_id: sessionId,
              preview_id: previewId!,
            });
      if (!requestIsCurrent()) return;
      if (
        result.preview.session_id !== sessionId ||
        (scope === "turn" && result.preview.preview_id !== previewId)
      ) {
        throw new Error("diff/preview/get returned a mismatched preview");
      }
      setDiffReview((current) => ({
        ...current,
        loading: false,
        result,
      }));
    } catch (reason) {
      if (!requestIsCurrent()) return;
      setDiffReview((current) => ({
        ...current,
        loading: false,
        error: errorMessage(reason),
      }));
    } finally {
      if (diffRequestsRef.current.finish(request)) {
        setDiffReview((current) =>
          current.loading ? { ...current, loading: false } : current,
        );
      }
    }

    function requestIsCurrent(): boolean {
      const latest = dependenciesRef.current;
      return diffRequestsRef.current.isCurrent(
        request,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  const closeDiffReview = () => {
    diffRequestsRef.current.invalidate();
    setDiffReview((current) => ({
      ...current,
      active: false,
      loading: false,
      result: null,
      error: null,
    }));
  };

  const restoreChanges = (
    sessionId: string,
    changes: readonly SessionFileChange[],
  ) => {
    if (sessionId !== dependenciesRef.current.sessionId()) return;
    diffRequestsRef.current.invalidate();
    setDiffReview((current) => ({
      ...current,
      latestPreviewId:
        changes.find((change) => change.previewId)?.previewId ?? null,
      active: false,
      loading: false,
      result: null,
      error: null,
    }));
  };

  const observeNotification = (notification: RpcNotification) => {
    const previewId = notificationDiffPreviewId(notification);
    if (!previewId) return;
    setDiffReview((current) => ({
      ...current,
      latestPreviewId: previewId,
    }));
  };

  const permissionView = useMemo<PermissionRuntimeState>(
    () => ({ ...permission, transition }),
    [permission, transition],
  );
  // Another tab confirmed its change to the open Session: read what it left.
  const refreshRef = useRef(refreshPermission);
  refreshRef.current = refreshPermission;
  useEffect(
    () =>
      transitions.onSettledElsewhere((sessionId) => {
        if (sessionId === dependenciesRef.current.sessionId())
          void refreshRef.current();
      }),
    [transitions],
  );

  return {
    permission: permissionView,
    diffReview,
    reset,
    cancelPending,
    configureCapabilities,
    refreshPermission,
    rereadPermission: () => refreshPermission(undefined, true),
    updatePermission,
    gatePermissionSet,
    openDiffReview,
    closeDiffReview,
    observeNotification,
    restoreChanges,
  };
}
