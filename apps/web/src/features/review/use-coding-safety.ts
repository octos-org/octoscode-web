import { useRef, useState } from "react";
import {
  CORE_UI_METHODS,
  isPreviewId,
  notificationDiffPreviewId,
  supportsMethod,
  type DiffPreviewGetResult,
  type OctosUiClient,
  type PermissionProfileListResult,
  type PermissionProfileUpdate,
  type RpcNotification,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { RequestAuthorityGate } from "../async/request-authority.ts";

export interface PermissionRuntimeState {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  result: PermissionProfileListResult | null;
  error: string | null;
}

export interface DiffReviewRuntimeState {
  available: boolean;
  latestPreviewId: string | null;
  active: boolean;
  loading: boolean;
  result: DiffPreviewGetResult | null;
  error: string | null;
}

const EMPTY_PERMISSION: PermissionRuntimeState = {
  available: false,
  editable: false,
  loading: false,
  busy: false,
  result: null,
  error: null,
};

const EMPTY_DIFF_REVIEW: DiffReviewRuntimeState = {
  available: false,
  latestPreviewId: null,
  active: false,
  loading: false,
  result: null,
  error: null,
};

interface CodingSafetyDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
  onPermissionApplied: (client: OctosUiClient) => void;
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
    useState<PermissionRuntimeState>(EMPTY_PERMISSION);
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
    }));
  };

  const refreshPermission = async (
    client = dependenciesRef.current.client(),
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

  const updatePermission = async (
    update: PermissionProfileUpdate,
  ): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    if (
      !client ||
      !sessionId ||
      !permission.available ||
      !permission.editable ||
      permissionBusyRef.current
    ) {
      return;
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
        (profile) =>
          profile.mode === next.mode && profile.network === next.network,
      )
    ) {
      setPermission((state) => ({
        ...state,
        error:
          "The requested permission profile was not advertised for this session",
      }));
      return;
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
      const result = await client.setPermissionProfile({
        session_id: sessionId,
        update,
      });
      if (!requestIsCurrent()) return;
      if (result.session_id !== sessionId) {
        throw new Error("permission/profile/set returned another session");
      }
      if (!result.applied) {
        throw new Error("The server did not apply the permission change");
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
      await refreshPermission(client);
      if (!requestIsCurrent()) return;
      dependenciesRef.current.onPermissionApplied(client);
    } catch (reason) {
      if (!requestIsCurrent()) return;
      setPermission((state) => ({
        ...state,
        error: errorMessage(reason),
      }));
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

  const openDiffReview = async (requestedPreviewId?: string): Promise<void> => {
    const currentDependencies = dependenciesRef.current;
    const client = currentDependencies.client();
    const sessionId = currentDependencies.sessionId();
    const previewId = requestedPreviewId ?? diffReview.latestPreviewId;
    if (
      !client ||
      !sessionId ||
      !previewId ||
      !isPreviewId(previewId) ||
      !supportsMethod(
        currentDependencies.capabilities(),
        CORE_UI_METHODS.DIFF_PREVIEW_GET,
      )
    ) {
      return;
    }

    const request = diffRequestsRef.current.begin(client, sessionId);
    setDiffReview((current) => ({
      ...current,
      latestPreviewId: previewId,
      active: true,
      loading: true,
      result: null,
      error: null,
    }));
    try {
      const result = await client.getDiffPreview({
        session_id: sessionId,
        preview_id: previewId,
      });
      if (!requestIsCurrent()) return;
      if (
        result.preview.session_id !== sessionId ||
        result.preview.preview_id !== previewId
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

  const observeNotification = (notification: RpcNotification) => {
    const previewId = notificationDiffPreviewId(notification);
    if (!previewId) return;
    setDiffReview((current) => ({
      ...current,
      latestPreviewId: previewId,
    }));
  };

  return {
    permission,
    diffReview,
    reset,
    configureCapabilities,
    refreshPermission,
    updatePermission,
    openDiffReview,
    closeDiffReview,
    observeNotification,
  };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
