import { useRef, useState } from "react";
import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type OctosUiClient,
  type ProfileLlmModel,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { RequestAuthorityGate } from "../async/request-authority.ts";
import {
  nextModelNoticeBoard,
  parseRuntimeDisposition,
  type ModelNoticeBoard,
  type ModelRuntimeDisposition,
} from "./model-settings.ts";

export interface ModelSelectionRuntimeState {
  available: boolean;
  editable: boolean;
  loading: boolean;
  busy: boolean;
  models: ProfileLlmModel[];
  restartHint: boolean;
  error: string | null;
  /** §4.2 sticky disposition notices (deferred / persisted_but_not_live / restart_required …). */
  noticeBoard: ModelNoticeBoard;
}

const EMPTY_MODEL_SELECTION: ModelSelectionRuntimeState = {
  available: false,
  editable: false,
  loading: false,
  busy: false,
  models: [],
  restartHint: false,
  error: null,
  noticeBoard: { notices: [] },
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
  /** §4.2: notices are kept on the session record with their time. */
  const noticeBoardRef = useRef<ModelNoticeBoard>({ notices: [] });
  const lastSeenSelectionRef = useRef<{
    model: string;
    provider: string;
    route?: string;
  } | null>(null);

  const reset = () => {
    refreshRequestsRef.current.invalidate();
    selectionRequestsRef.current.invalidate();
    busyRef.current = false;
    noticeBoardRef.current = { notices: [] };
    lastSeenSelectionRef.current = null;
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
    noticeBoardRef.current = { notices: [] };
    lastSeenSelectionRef.current = null;
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
      observeListResult(result.models);
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

  /** Case 23: a refreshed list proving another actor changed the selection. */
  const observeListResult = (
    models: readonly {
      model: string;
      provider: string;
      route?: string;
      selected: boolean;
    }[],
  ) => {
    const selected = models.find((model) => model.selected);
    const identity = selected
      ? {
          model: selected.model,
          provider: selected.provider,
          ...(selected.route ? { route: selected.route } : {}),
        }
      : undefined;
    const previouslySeen = lastSeenSelectionRef.current;
    noticeBoardRef.current = nextModelNoticeBoard(noticeBoardRef.current, {
      listRefreshed: models,
      ...(previouslySeen ? { lastSeenSelection: previouslySeen } : {}),
      atMs: Date.now(),
    });
    if (identity) lastSeenSelectionRef.current = identity;
    setState((snapshot) => ({
      ...snapshot,
      noticeBoard: noticeBoardRef.current,
    }));
  };

  /** Judge #6: fold a select result's runtime_disposition into the board. */
  const applyDisposition = (
    raw: unknown,
    selected: { model: string; provider: string; route?: string | undefined },
    runningModel: string | null | undefined,
    failed: string | null,
  ) => {
    const parsed = failed
      ? ({ disposition: "refused", reason: failed } as const)
      : (parseRuntimeDisposition(raw) ?? {
          disposition: "persisted" as ModelRuntimeDisposition,
        });
    noticeBoardRef.current = nextModelNoticeBoard(
      noticeBoardRef.current,
      {
        disposition: parsed.disposition,
        savedModel: {
          model: selected.model,
          provider: selected.provider,
          ...(selected.route ? { route: selected.route } : {}),
        },
        ...("condition" in parsed && parsed.condition
          ? { condition: parsed.condition }
          : {}),
        ...(runningModel ? { runningModel } : {}),
        ...("runtimeError" in parsed && parsed.runtimeError
          ? { runtimeError: parsed.runtimeError }
          : {}),
        ...("reason" in parsed && parsed.reason ? { reason: parsed.reason } : {}),
        atMs: Date.now(),
      },
      { t: (source) => source },
    );
    lastSeenSelectionRef.current = {
      model: selected.model,
      provider: selected.provider,
      ...(selected.route ? { route: selected.route } : {}),
    };
    setState((snapshot) => ({
      ...snapshot,
      noticeBoard: noticeBoardRef.current,
      // A refused save reverts the selection: restartHint never lights.
      restartHint:
      parsed.disposition === "restart_required"
          ? true
          : parsed.disposition === "refused"
            ? false
            : snapshot.restartHint,
    }));
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
    noticeBoardRef.current = nextModelNoticeBoard(noticeBoardRef.current, {
      saving: true,
    });
    setState((snapshot) => ({
      ...snapshot,
      loading: false,
      busy: true,
      error: null,
      noticeBoard: noticeBoardRef.current,
    }));
    let rawResult: unknown = null;
    let failedReason: string | null = null;
    try {
      const result = await client.selectProfileModel({
        session_id: sessionId,
        ...(profileId ? { profile_id: profileId } : {}),
        family_id: target.family ?? target.provider,
        model_id: target.model,
        ...(target.route ? { route_id: target.route } : {}),
      });
      if (!selectionRequestIsCurrent(request)) return;
      rawResult = result as unknown;
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
      applyDisposition(
        rawResult,
        {
          model: result.selected.model,
          provider: result.selected.provider,
          route: result.selected.route,
        },
        undefined,
        null,
      );
      await refresh(client);
    } catch (reason) {
      if (!selectionRequestIsCurrent(request)) return;
      failedReason = errorMessage(reason);
      applyDisposition(
        rawResult,
        {
          model: target.model,
          provider: target.provider,
          route: target.route,
        },
        undefined,
        failedReason,
      );
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
