import { useRef, useState } from "react";
import {
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
  const requestRef = useRef(0);
  const permissionBusyRef = useRef(false);
  const [permission, setPermission] =
    useState<PermissionRuntimeState>(EMPTY_PERMISSION);
  const [diffReview, setDiffReview] =
    useState<DiffReviewRuntimeState>(EMPTY_DIFF_REVIEW);

  const reset = () => {
    permissionBusyRef.current = false;
    requestRef.current += 1;
    setPermission(EMPTY_PERMISSION);
    setDiffReview(EMPTY_DIFF_REVIEW);
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    const permissionAvailable = supportsMethod(
      capabilities,
      "permission/profile/list",
    );
    setPermission((current) => ({
      ...current,
      available: permissionAvailable,
      editable:
        permissionAvailable &&
        supportsMethod(capabilities, "permission/profile/set"),
    }));
    setDiffReview((current) => ({
      ...current,
      available: supportsMethod(capabilities, "diff/preview/get"),
    }));
  };

  const refreshPermission = async (
    client = dependencies.client(),
  ): Promise<void> => {
    const sessionId = dependencies.sessionId();
    if (
      !client ||
      !sessionId ||
      !supportsMethod(dependencies.capabilities(), "permission/profile/list")
    ) {
      return;
    }
    setPermission((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await client.listPermissionProfiles({
        session_id: sessionId,
      });
      if (
        dependencies.client() !== client ||
        dependencies.sessionId() !== sessionId
      ) {
        return;
      }
      if (result.session_id !== sessionId) {
        throw new Error("permission/profile/list returned another session");
      }
      setPermission((current) => ({ ...current, loading: false, result }));
    } catch (reason) {
      if (dependencies.client() !== client) return;
      setPermission((current) => ({
        ...current,
        loading: false,
        error: errorMessage(reason),
      }));
    }
  };

  const updatePermission = async (
    update: PermissionProfileUpdate,
  ): Promise<void> => {
    const client = dependencies.client();
    const sessionId = dependencies.sessionId();
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

    permissionBusyRef.current = true;
    setPermission((state) => ({ ...state, busy: true, error: null }));
    try {
      const result = await client.setPermissionProfile({
        session_id: sessionId,
        update,
      });
      if (
        dependencies.client() !== client ||
        dependencies.sessionId() !== sessionId
      ) {
        return;
      }
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
      dependencies.onPermissionApplied(client);
    } catch (reason) {
      if (dependencies.client() !== client) return;
      permissionBusyRef.current = false;
      setPermission((state) => ({
        ...state,
        busy: false,
        error: errorMessage(reason),
      }));
    }
  };

  const openDiffReview = async (requestedPreviewId?: string): Promise<void> => {
    const client = dependencies.client();
    const sessionId = dependencies.sessionId();
    const previewId = requestedPreviewId ?? diffReview.latestPreviewId;
    if (
      !client ||
      !sessionId ||
      !previewId ||
      !isPreviewId(previewId) ||
      !supportsMethod(dependencies.capabilities(), "diff/preview/get")
    ) {
      return;
    }

    const request = requestRef.current + 1;
    requestRef.current = request;
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
      if (
        dependencies.client() !== client ||
        requestRef.current !== request ||
        dependencies.sessionId() !== sessionId
      ) {
        return;
      }
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
      if (dependencies.client() !== client || requestRef.current !== request) {
        return;
      }
      setDiffReview((current) => ({
        ...current,
        loading: false,
        error: errorMessage(reason),
      }));
    }
  };

  const closeDiffReview = () => {
    requestRef.current += 1;
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
