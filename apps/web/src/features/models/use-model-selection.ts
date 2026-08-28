import { useRef, useState } from "react";
import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type OctosUiClient,
  type ProfileLlmModel,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { RequestAuthorityGate } from "../async/request-authority.ts";

export interface ModelSelectionRuntimeState {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  models: ProfileLlmModel[];
  restartHint: boolean;
  error: string | null;
}

const EMPTY_MODEL_SELECTION: ModelSelectionRuntimeState = {
  available: false,
  editable: false,
  loading: false,
  busy: false,
  models: [],
  restartHint: false,
  error: null,
};

interface ModelSelectionDependencies {
  client: () => OctosUiClient | null;
  sessionId: () => string;
  profileId: () => string;
  capabilities: () => UiProtocolCapabilities | undefined;
}

export function useModelSelection(dependencies: ModelSelectionDependencies) {
  const refreshRequestsRef = useRef(new RequestAuthorityGate<OctosUiClient>());
  const selectionRequestsRef = useRef(
    new RequestAuthorityGate<OctosUiClient>(),
  );
  const busyRef = useRef(false);
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const [state, setState] = useState<ModelSelectionRuntimeState>(
    EMPTY_MODEL_SELECTION,
  );

  const reset = () => {
    refreshRequestsRef.current.invalidate();
    selectionRequestsRef.current.invalidate();
    busyRef.current = false;
    setState(EMPTY_MODEL_SELECTION);
  };

  const configureCapabilities = (
    capabilities: UiProtocolCapabilities | undefined,
  ) => {
    // A hydrate/reconnect capability projection is a new transport authority.
    // Retire requests that may never settle on the replaced socket and make
    // the freshly configured controller immediately usable.
    refreshRequestsRef.current.invalidate();
    selectionRequestsRef.current.invalidate();
    busyRef.current = false;
    setState((current) => ({
      ...current,
      loading: false,
      busy: false,
      available: supportsMethod(
        capabilities,
        APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      ),
      editable: supportsMethod(
        capabilities,
        APPUI_ONBOARDING_METHODS.PROFILE_LLM_SELECT,
      ),
    }));
  };

  const refresh = async (
    client = dependenciesRef.current.client(),
  ): Promise<void> => {
    const current = dependenciesRef.current;
    const sessionId = current.sessionId();
    const profileId = current.profileId();
    if (
      !client ||
      !sessionId ||
      busyRef.current ||
      !supportsMethod(
        current.capabilities(),
        APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
      )
    ) {
      return;
    }
    const request = refreshRequestsRef.current.begin(client, sessionId);
    setState((snapshot) => ({ ...snapshot, loading: true, error: null }));
    try {
      const result = await client.listProfileModels({
        session_id: sessionId,
        ...(profileId ? { profile_id: profileId } : {}),
      });
      if (!refreshRequestIsCurrent(request)) {
        return;
      }
      if (result.session_id !== sessionId) {
        throw new Error("profile/llm/list returned another session");
      }
      setState((snapshot) => ({
        ...snapshot,
        loading: false,
        models: result.models,
      }));
    } catch (reason) {
      if (!refreshRequestIsCurrent(request)) return;
      setState((snapshot) => ({
        ...snapshot,
        loading: false,
        error: errorMessage(reason),
      }));
    } finally {
      if (refreshRequestsRef.current.finish(request)) {
        setState((snapshot) =>
          snapshot.loading ? { ...snapshot, loading: false } : snapshot,
        );
      }
    }

    function refreshRequestIsCurrent(authority: typeof request): boolean {
      const latest = dependenciesRef.current;
      return refreshRequestsRef.current.isCurrent(
        authority,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  const select = async (target: ProfileLlmModel): Promise<void> => {
    const current = dependenciesRef.current;
    const client = current.client();
    const sessionId = current.sessionId();
    const profileId = current.profileId();
    if (
      !client ||
      !sessionId ||
      !state.editable ||
      !target.available ||
      busyRef.current ||
      !state.models.some(
        (model) =>
          model.model === target.model &&
          model.provider === target.provider &&
          model.route === target.route,
      )
    ) {
      return;
    }
    refreshRequestsRef.current.invalidate();
    const request = selectionRequestsRef.current.begin(client, sessionId);
    busyRef.current = true;
    setState((snapshot) => ({
      ...snapshot,
      loading: false,
      busy: true,
      error: null,
    }));
    try {
      const result = await client.selectProfileModel({
        session_id: sessionId,
        ...(profileId ? { profile_id: profileId } : {}),
        family_id: target.family ?? target.provider,
        model_id: target.model,
        ...(target.route ? { route_id: target.route } : {}),
      });
      if (!selectionRequestIsCurrent(request)) return;
      if (result.session_id !== sessionId || !result.applied) {
        throw new Error("The server did not apply the model selection");
      }
      setState((snapshot) => ({
        ...snapshot,
        busy: false,
        restartHint: result.restart_required === true,
        models: snapshot.models.map((model) => ({
          ...model,
          selected:
            model.model === result.selected.model &&
            model.provider === result.selected.provider &&
            model.route === result.selected.route,
        })),
      }));
      busyRef.current = false;
      await refresh(client);
    } catch (reason) {
      if (!selectionRequestIsCurrent(request)) return;
      setState((snapshot) => ({
        ...snapshot,
        error: errorMessage(reason),
      }));
    } finally {
      if (selectionRequestsRef.current.finish(request)) {
        busyRef.current = false;
        setState((snapshot) =>
          snapshot.busy ? { ...snapshot, busy: false } : snapshot,
        );
      }
    }

    function selectionRequestIsCurrent(authority: typeof request): boolean {
      const latest = dependenciesRef.current;
      return selectionRequestsRef.current.isCurrent(
        authority,
        latest.client(),
        latest.sessionId(),
      );
    }
  };

  return { state, reset, configureCapabilities, refresh, select };
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
