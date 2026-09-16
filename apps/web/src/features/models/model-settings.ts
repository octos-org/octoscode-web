import {
  APPUI_ONBOARDING_METHODS,
  supportsMethod,
  type LlmCatalogResult,
  type LlmSelection,
  type LlmTestResult,
  type LlmUpsertResult,
  type OctosUiClient,
  type ProfileLlmConfigResult,
  type ProfileLlmDeleteResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  parseLlmInferenceOverrides,
  type LlmInferenceOverrides,
} from "@octos-org/octoscode-client/onboarding";
import {
  RequestAuthorityGate,
  type RequestAuthority,
} from "../async/request-authority.ts";

/**
 * AppUI model-management methods shipped by the pinned Octos Core runtime.
 *
 * Keep capability decisions per operation. A server that can list configured
 * models but cannot mutate them still has a useful, read-only settings surface;
 * a missing probe method must never be inferred from another LLM method.
 */
export const MODEL_SETTINGS_METHODS = {
  READ: APPUI_ONBOARDING_METHODS.PROFILE_LLM_LIST,
  CATALOG: APPUI_ONBOARDING_METHODS.PROFILE_LLM_CATALOG,
  TEST: APPUI_ONBOARDING_METHODS.PROFILE_LLM_TEST,
  UPSERT: APPUI_ONBOARDING_METHODS.PROFILE_LLM_UPSERT,
  DELETE: APPUI_ONBOARDING_METHODS.PROFILE_LLM_DELETE,
  FETCH_MODELS: APPUI_ONBOARDING_METHODS.PROFILE_LLM_FETCH_MODELS,
} as const;

export interface ModelSettingsCapabilities {
  read: boolean;
  catalog: boolean;
  test: boolean;
  save: boolean;
  delete: boolean;
  fetchModels: boolean;
}

export interface ModelRouteDraft {
  routeId: string;
  label?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiType?: string;
}

/** A provider/model draft deliberately contains no raw credential field. */
export interface ModelSettingsDraft {
  familyId: string;
  modelId: string;
  route: ModelRouteDraft;
  setPrimary: boolean;
  /** Hidden configured values are preserved, not offered as new inference controls. */
  inference?: LlmInferenceOverrides;
  editBlocked?: true;
}

export interface ModelSettingsTestResult {
  profileId: string;
  applied: boolean;
  message: string;
  error: string | null;
}

export interface ModelSettingsMutationResult {
  profileId: string;
  applied: boolean;
}

export interface ModelSettingsFetchResult {
  profileId: string;
  familyId: string;
  models: string[];
  reason: string | null;
}

export interface ModelSettingsSaveResult {
  test: ModelSettingsTestResult;
  mutation: ModelSettingsMutationResult;
}

export type ModelSettingsPhase =
  "idle" | "loading" | "testing" | "fetching_models" | "saving" | "deleting";

/** The §4.2 `profile/llm/select` runtime dispositions, plus two derived kinds. */
export type ModelRuntimeDisposition =
  /** Legacy servers: `applied` without a disposition means persisted only. */
  | "persisted"
  /** The select call was refused (error or applied=false without a disposition). */
  | "reloaded"
  | "deferred"
  | "restart_required"
  | "persisted_but_not_live"
  | "unchanged"
  | "refused";

/** What `parseRuntimeDisposition` extracted from one select result. */
export interface RuntimeDispositionResult {
  disposition: ModelRuntimeDisposition;
  /** `persisted_but_not_live` reason. */
  runtimeError?: string;
  /** `deferred` condition, when the server returned one. */
  condition?: string;
}

/**
 * Judge #6 / §5.3: read `runtime_disposition` off the raw select result.
 *
 * The typed client result (ProfileLlmSelectResult) does not yet carry the
 * field — this accepts the raw wire value so the pane never needs protocol
 * vocabulary, while remaining pure and total over the five contract states.
 */
export function parseRuntimeDisposition(
  raw: unknown,
): RuntimeDispositionResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const disposition = record.runtime_disposition;
  if (disposition === undefined) {
    if (record.applied === true) return { disposition: "persisted" };
    return null;
  }
  if (typeof disposition !== "string") return null;
  const runtimeError =
    typeof record.runtime_error === "string" ? record.runtime_error : undefined;
  const condition =
    typeof record.condition === "string" ? record.condition : undefined;
  switch (disposition) {
    case "reloaded":
    case "deferred":
    case "restart_required":
    case "persisted_but_not_live":
    case "unchanged":
      return {
        disposition,
        ...(runtimeError ? { runtimeError } : {}),
        ...(condition ? { condition } : {}),
      };
    default:
      return { disposition: "refused" };
  }
}

/** The saved/running selection identity the notice board compares (§4.2). */
export interface ModelSelectionIdentity {
  model: string;
  provider: string;
  route?: string | undefined;
}

/** Minimal translator seam so messages stay catalog-driven (§8 both languages). */
export interface NoticeTranslator {
  t: (source: string, params?: Record<string, string | number>) => string;
}

export interface DispositionMessageInput {
  disposition: ModelRuntimeDisposition;
  savedModel?: { model: string } | undefined;
  condition?: string | undefined;
  runningModel?: string | undefined;
  runtimeError?: string | undefined;
  reason?: string | undefined;
}

/**
 * The five §4.2 messages, exactly — plus the legacy-persisted and refused
 * fallbacks. Pure: the caller decides stickiness via nextModelNoticeBoard.
 */
export function noticeMessage(
  input: DispositionMessageInput,
  { t }: NoticeTranslator,
): string {
  switch (input.disposition) {
    case "reloaded":
      return t("Saved. Your next message uses {value0}", {
        value0: input.savedModel?.model ?? t("the new model"),
      });
    case "deferred":
      return input.condition
        ? t("Saved. The model is not active yet ({value0})", {
            value0: input.condition,
          })
        : t("Saved. The model is not active yet");
    case "restart_required":
      return t("Saved. The server keeps running {value0} until it restarts", {
        value0: input.runningModel ?? t("the previous model"),
      });
    case "persisted_but_not_live":
      return t("Saved, but not usable right now: {value0}", {
        value0: input.runtimeError ?? t("the runtime could not start"),
      });
    case "unchanged":
      return t("Already selected");
    case "persisted":
      return t("Saved");
    case "refused":
      return t("Couldn't save: {value0}", {
        value0: input.reason ?? t("the server refused the change"),
      });
  }
}

/** One sticky notice on the session record, with its time (§4.2). */
export interface DispositionNoticeOutcome {
  kind: ModelRuntimeDisposition;
  model?: ModelSelectionIdentity | undefined;
  message: string;
  /** `restart_required`: the model the boot snapshot keeps serving. */
  runningModel?: string | undefined;
  atMs: number;
}

/** The notice board §4.2 keeps on the session record. */
export interface ModelNoticeBoard {
  notices: readonly DispositionNoticeOutcome[];
  /** True right after a refused save (selection must revert). */
  selectionReverted?: boolean | undefined;
  /** True while a select is in flight (Saving…; transient, not a notice). */
  saving?: boolean | undefined;
  /** True after a list refresh showed a different saved selection (case 23). */
  externalChange?: boolean | undefined;
}

export type ModelNoticeEvent =
  | {
      disposition: ModelRuntimeDisposition;
      savedModel?:
        { model: string; provider: string; route?: string } | undefined;
      condition?: string | undefined;
      runningModel?: string | undefined;
      runtimeError?: string | undefined;
      reason?: string | undefined;
      atMs: number;
    }
  | {
      turnStampModel:
        { model: string; provider: string; route?: string } | undefined;
      atMs: number;
    }
  | {
      listRefreshed: readonly {
        model: string;
        provider: string;
        route?: string;
        selected: boolean;
      }[];
      lastSeenSelection?: ModelSelectionIdentity | undefined;
      atMs: number;
    }
  | { saving: boolean; atMs?: number }
  | { clearSelectionReverted: true };

const identityEquals = (
  a: ModelSelectionIdentity | undefined,
  b: ModelSelectionIdentity | undefined,
): boolean =>
  a !== undefined &&
  b !== undefined &&
  a.model === b.model &&
  a.provider === b.provider &&
  (a.route ?? "") === (b.route ?? "");

/**
 * Judge #6 sticky rules (§4.2, acceptance 23b):
 * - `deferred` clears when a turn stamp shows the model or a `reloaded`
 *   result arrives for the same selection.
 * - `persisted_but_not_live` is sticky: neither a matching turn stamp nor a
 *   successful `profile/llm/list` refresh clears it (the list carries no
 *   runtime-error field); only a later `reloaded` for that selection clears it.
 * - `restart_required` persists until restart; `unchanged` preserves every
 *   outstanding restart/error notice unchanged.
 */
export function nextModelNoticeBoard(
  board: ModelNoticeBoard,
  event: ModelNoticeEvent,
  translator?: NoticeTranslator,
): ModelNoticeBoard {
  if ("saving" in event) {
    return { ...board, saving: event.saving };
  }
  if ("clearSelectionReverted" in event) {
    const { selectionReverted: _drop, ...rest } = board;
    return rest;
  }
  if ("turnStampModel" in event) {
    return {
      ...board,
      notices: board.notices.filter(
        (notice) =>
          notice.kind !== "deferred" ||
          !identityEquals(notice.model, event.turnStampModel),
      ),
    };
  }
  if ("listRefreshed" in event) {
    const selected = event.listRefreshed.find((model) => model.selected);
    const selectedIdentity: ModelSelectionIdentity | undefined = selected
      ? {
          model: selected.model,
          provider: selected.provider,
          route: selected.route,
        }
      : undefined;
    // A successful refresh never clears persisted_but_not_live (§4.2: the
    // list carries no runtime-error field, so its absence proves nothing).
    return {
      ...board,
      externalChange:
        event.lastSeenSelection !== undefined &&
        !identityEquals(event.lastSeenSelection, selectedIdentity),
    };
  }
  const { disposition, atMs } = event;
  const messageFor = (): string =>
    translator
      ? noticeMessage(
          {
            disposition,
            ...(event.savedModel ? { savedModel: event.savedModel } : {}),
            ...(event.condition ? { condition: event.condition } : {}),
            ...(event.runningModel ? { runningModel: event.runningModel } : {}),
            ...(event.runtimeError ? { runtimeError: event.runtimeError } : {}),
            ...(event.reason ? { reason: event.reason } : {}),
          },
          translator,
        )
      : "";
  if (disposition === "unchanged") return { ...board };
  if (disposition === "refused") {
    return {
      ...board,
      selectionReverted: true,
      notices: [
        ...board.notices,
        {
          kind: "refused",
          model: event.savedModel
            ? {
                model: event.savedModel.model,
                provider: event.savedModel.provider,
                route: event.savedModel.route,
              }
            : undefined,
          message: messageFor(),
          atMs,
        },
      ],
    };
  }
  const identity: ModelSelectionIdentity | undefined = event.savedModel
    ? {
        model: event.savedModel.model,
        provider: event.savedModel.provider,
        route: event.savedModel.route,
      }
    : undefined;
  // `reloaded` for a selection proves the server restarted into it or
  // bootstrapped the runtime: it clears that selection's deferred,
  // persisted_but_not_live AND restart_required notices (§4.2/23b). Other
  // selections' notices stay.
  const kept =
    disposition === "reloaded"
      ? board.notices.filter(
          (notice) => !identityEquals(notice.model, identity),
        )
      : board.notices;
  const outcome: DispositionNoticeOutcome = {
    kind: disposition,
    model: identity,
    message: messageFor(),
    ...(event.runningModel ? { runningModel: event.runningModel } : {}),
    atMs,
  };
  return {
    ...board,
    selectionReverted: undefined,
    notices: [...kept, outcome],
  };
}

export interface ModelSettingsState {
  capabilities: ModelSettingsCapabilities;
  phase: ModelSettingsPhase;
  catalog: LlmCatalogResult | null;
  configuration: ProfileLlmConfigResult | null;
  fetchedModels: string[];
  lastTest: ModelSettingsTestResult | null;
  error: string | null;
}

/** Structural client seam so the controller remains independent of React. */
export type ModelSettingsClient = Pick<
  OctosUiClient,
  | "readProfileLlmConfig"
  | "getLlmCatalog"
  | "testLlmProfile"
  | "upsertLlmProfile"
  | "fetchLlmModels"
  | "deleteProfileModel"
>;

export interface ModelSettingsControllerDependencies {
  client: () => ModelSettingsClient | null;
  profileId: () => string;
  publish: (state: ModelSettingsState) => void;
}

const EMPTY_CAPABILITIES: ModelSettingsCapabilities = {
  read: false,
  catalog: false,
  test: false,
  save: false,
  delete: false,
  fetchModels: false,
};

export function emptyModelSettingsState(): ModelSettingsState {
  return {
    capabilities: EMPTY_CAPABILITIES,
    phase: "idle",
    catalog: null,
    configuration: null,
    fetchedModels: [],
    lastTest: null,
    error: null,
  };
}

export function modelSettingsCapabilities(
  capabilities: UiProtocolCapabilities | undefined,
): ModelSettingsCapabilities {
  return {
    read: supportsMethod(capabilities, MODEL_SETTINGS_METHODS.READ),
    catalog: supportsMethod(capabilities, MODEL_SETTINGS_METHODS.CATALOG),
    test: supportsMethod(capabilities, MODEL_SETTINGS_METHODS.TEST),
    save: supportsMethod(capabilities, MODEL_SETTINGS_METHODS.UPSERT),
    delete: supportsMethod(capabilities, MODEL_SETTINGS_METHODS.DELETE),
    fetchModels: supportsMethod(
      capabilities,
      MODEL_SETTINGS_METHODS.FETCH_MODELS,
    ),
  };
}

/**
 * Profile-scoped async controller used by the React hook and unit tests.
 *
 * The API key is accepted only as an operation argument. It is copied into a
 * request object local to that operation and never assigned to this controller
 * or any published state. Every result is guarded by transport/profile
 * authority before it may be published.
 */
export class ModelSettingsController {
  readonly #dependencies: ModelSettingsControllerDependencies;
  readonly #requests = new RequestAuthorityGate<ModelSettingsClient>();
  #state = emptyModelSettingsState();
  #busy = false;

  constructor(dependencies: ModelSettingsControllerDependencies) {
    this.#dependencies = dependencies;
  }

  get snapshot(): ModelSettingsState {
    return this.#state;
  }

  configureCapabilities(
    capabilities: UiProtocolCapabilities | undefined,
  ): void {
    this.#requests.invalidate();
    this.#busy = false;
    this.#replace({
      ...emptyModelSettingsState(),
      capabilities: modelSettingsCapabilities(capabilities),
    });
  }

  reset(): void {
    this.#requests.invalidate();
    this.#busy = false;
    this.#replace(emptyModelSettingsState());
  }

  async refresh(): Promise<void> {
    const operation = this.#begin("loading", (capabilities) =>
      Boolean(capabilities.read || capabilities.catalog),
    );
    if (!operation) return;
    const { client, profileId, authority } = operation;
    const errors: string[] = [];
    let configuration = this.#state.configuration;
    let catalog = this.#state.catalog;
    try {
      const [configurationResult, catalogResult] = await Promise.all([
        this.#state.capabilities.read
          ? settle(client.readProfileLlmConfig({ profile_id: profileId }))
          : Promise.resolve<Settled<ProfileLlmConfigResult>>({
              status: "skipped",
            }),
        this.#state.capabilities.catalog
          ? settle(client.getLlmCatalog())
          : Promise.resolve<Settled<LlmCatalogResult>>({ status: "skipped" }),
      ]);
      if (!this.#isCurrent(authority)) return;

      if (configurationResult.status === "fulfilled") {
        assertProfile(configurationResult.value.profile_id, profileId);
        configuration = configurationResult.value;
      } else if (configurationResult.status === "rejected") {
        errors.push(errorText(configurationResult.reason));
      }
      if (catalogResult.status === "fulfilled") {
        catalog = catalogResult.value;
      } else if (catalogResult.status === "rejected") {
        errors.push(errorText(catalogResult.reason));
      }
      this.#update({
        configuration,
        catalog,
        error: errors.length
          ? redactModelSettingsError(errors.join("; "))
          : null,
      });
    } catch (reason) {
      if (!this.#isCurrent(authority)) return;
      this.#update({ error: redactModelSettingsError(reason) });
    } finally {
      this.#finish(authority);
    }
  }

  async test(
    draft: ModelSettingsDraft,
    apiKey?: string,
  ): Promise<ModelSettingsTestResult | null> {
    const operation = this.#begin(
      "testing",
      (capabilities) => capabilities.test,
    );
    if (!operation) return null;
    const { client, profileId, authority } = operation;
    const secret = normalizedSecret(apiKey);
    try {
      const provision = provisionParams(profileId, draft, secret);
      const result = await client.testLlmProfile(provision);
      if (!this.#isCurrent(authority)) return null;
      assertProfile(result.profile_id, profileId);
      const safe = safeTestResult(result, secret);
      this.#update({
        lastTest: safe,
        error:
          safe.applied && !safe.error
            ? null
            : safe.error || safe.message || "The provider test did not pass.",
      });
      return safe;
    } catch (reason) {
      if (!this.#isCurrent(authority)) return null;
      this.#update({ error: redactModelSettingsError(reason, secret) });
      return null;
    } finally {
      this.#finish(authority);
    }
  }

  async fetchModels(
    draft: Pick<ModelSettingsDraft, "familyId" | "route">,
    apiKey?: string,
  ): Promise<ModelSettingsFetchResult | null> {
    const operation = this.#begin(
      "fetching_models",
      (capabilities) => capabilities.fetchModels,
    );
    if (!operation) return null;
    const { client, profileId, authority } = operation;
    const secret = normalizedSecret(apiKey);
    try {
      const familyId = requiredText(draft.familyId, "Provider family");
      const result = await client.fetchLlmModels({
        profile_id: profileId,
        selection: {
          family_id: familyId,
          route: routeSelection(draft.route),
        },
        ...(secret ? { api_key: secret } : {}),
      });
      if (!this.#isCurrent(authority)) return null;
      assertProfile(result.profile_id, profileId);
      if (result.family_id !== familyId) {
        throw new Error("profile/llm/fetch_models returned another family");
      }
      const safeReason = result.reason
        ? redactModelSettingsError(result.reason, secret)
        : null;
      const safe: ModelSettingsFetchResult = {
        profileId,
        familyId,
        models: result.models.slice(),
        reason: safeReason,
      };
      this.#update({
        fetchedModels: safe.models,
        error:
          safe.models.length === 0 && safe.reason
            ? fetchFailureMessage(safe.reason)
            : null,
      });
      return safe;
    } catch (reason) {
      if (!this.#isCurrent(authority)) return null;
      this.#update({ error: redactModelSettingsError(reason, secret) });
      return null;
    } finally {
      this.#finish(authority);
    }
  }

  async save(
    draft: ModelSettingsDraft,
    apiKey?: string,
  ): Promise<ModelSettingsSaveResult | null> {
    const operation = this.#begin(
      "testing",
      (capabilities) => capabilities.test && capabilities.save,
    );
    if (!operation) return null;
    const { client, profileId, authority } = operation;
    const secret = normalizedSecret(apiKey);
    // Construct this ONCE. Test and save therefore cannot drift by rebuilding
    // the route/model from mutable UI state between the two awaited calls.
    try {
      const provision = provisionParams(profileId, draft, secret);
      const setPrimary = draft.setPrimary;
      const testedWire = await client.testLlmProfile(provision);
      if (!this.#isCurrent(authority)) return null;
      assertProfile(testedWire.profile_id, profileId);
      const tested = safeTestResult(testedWire, secret);
      this.#update({ lastTest: tested });
      if (!tested.applied || tested.error) {
        throw new Error(
          tested.error || tested.message || "The provider test did not pass.",
        );
      }

      this.#update({ phase: "saving", error: null });
      const savedWire = await client.upsertLlmProfile({
        ...provision,
        set_primary: setPrimary,
      });
      if (!this.#isCurrent(authority)) return null;
      assertProfile(savedWire.profile_id, profileId);
      if (!savedWire.applied) {
        throw new Error(
          "The server did not save the tested model configuration.",
        );
      }
      const mutation = safeMutationResult(savedWire);
      const refreshError = await this.#refreshConfigurationAfterMutation(
        client,
        profileId,
        authority,
      );
      if (!this.#isCurrent(authority)) return null;
      this.#update({ error: refreshError });
      return { test: tested, mutation };
    } catch (reason) {
      if (!this.#isCurrent(authority)) return null;
      this.#update({ error: redactModelSettingsError(reason, secret) });
      return null;
    } finally {
      this.#finish(authority);
    }
  }

  async delete(
    target: Pick<ModelSettingsDraft, "familyId" | "modelId" | "route">,
  ): Promise<ModelSettingsMutationResult | null> {
    const operation = this.#begin(
      "deleting",
      (capabilities) => capabilities.delete,
    );
    if (!operation) return null;
    const { client, profileId, authority } = operation;
    try {
      const result = await client.deleteProfileModel({
        profile_id: profileId,
        family_id: requiredText(target.familyId, "Provider family"),
        model_id: requiredText(target.modelId, "Model"),
        route_id: requiredText(target.route.routeId, "Provider route"),
      });
      if (!this.#isCurrent(authority)) return null;
      assertProfile(result.profile_id, profileId);
      const mutation = safeMutationResult(result);
      this.#update({
        configuration: configurationFromDelete(result),
        error: null,
      });
      return mutation;
    } catch (reason) {
      if (!this.#isCurrent(authority)) return null;
      this.#update({ error: redactModelSettingsError(reason) });
      return null;
    } finally {
      this.#finish(authority);
    }
  }

  #begin(
    phase: ModelSettingsPhase,
    supported: (capabilities: ModelSettingsCapabilities) => boolean,
  ): {
    client: ModelSettingsClient;
    profileId: string;
    authority: RequestAuthority<ModelSettingsClient>;
  } | null {
    const client = this.#dependencies.client();
    const profileId = this.#dependencies.profileId().trim();
    if (
      !client ||
      !profileId ||
      this.#busy ||
      !supported(this.#state.capabilities)
    ) {
      return null;
    }
    this.#busy = true;
    const authority = this.#requests.begin(client, profileId);
    this.#update({ phase, error: null });
    return { client, profileId, authority };
  }

  #isCurrent(authority: RequestAuthority<ModelSettingsClient>): boolean {
    return this.#requests.isCurrent(
      authority,
      this.#dependencies.client(),
      this.#dependencies.profileId().trim(),
    );
  }

  #finish(authority: RequestAuthority<ModelSettingsClient>): void {
    if (!this.#requests.finish(authority)) return;
    this.#busy = false;
    this.#update({ phase: "idle" });
  }

  async #refreshConfigurationAfterMutation(
    client: ModelSettingsClient,
    profileId: string,
    authority: RequestAuthority<ModelSettingsClient>,
  ): Promise<string | null> {
    if (!this.#state.capabilities.read) return null;
    try {
      const configuration = await client.readProfileLlmConfig({
        profile_id: profileId,
      });
      if (!this.#isCurrent(authority)) return null;
      assertProfile(configuration.profile_id, profileId);
      this.#update({ configuration });
      return null;
    } catch (reason) {
      if (!this.#isCurrent(authority)) return null;
      return `Saved, but could not refresh model settings: ${redactModelSettingsError(reason)}`;
    }
  }

  #replace(state: ModelSettingsState): void {
    this.#state = state;
    this.#dependencies.publish(state);
  }

  #update(patch: Partial<ModelSettingsState>): void {
    this.#replace({ ...this.#state, ...patch });
  }
}

export function selectionFromModelSettingsDraft(
  draft: ModelSettingsDraft,
): LlmSelection {
  if (draft.editBlocked)
    throw new Error(
      "This configured model contains settings this editor cannot preserve. Edit it through Core configuration instead.",
    );
  const inference = parseLlmInferenceOverrides(draft.inference ?? {});
  if (!inference)
    throw new Error(
      "The configured model inference settings cannot be safely preserved.",
    );
  return {
    ...inference,
    family_id: requiredText(draft.familyId, "Provider family"),
    model_id: requiredText(draft.modelId, "Model"),
    route: routeSelection(draft.route),
  };
}

export function redactModelSettingsError(
  reason: unknown,
  secret?: string,
): string {
  let message = errorText(reason);
  const candidates = [secret, secret?.trim()].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of new Set(candidates)) {
    message = message.replaceAll(candidate, "[redacted]");
    try {
      message = message.replaceAll(encodeURIComponent(candidate), "[redacted]");
    } catch {
      // A malformed Unicode secret can still be redacted in its literal form.
    }
  }
  return message
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .slice(0, 1_000);
}

function provisionParams(
  profileId: string,
  draft: ModelSettingsDraft,
  secret: string | undefined,
) {
  return {
    profile_id: profileId,
    selection: selectionFromModelSettingsDraft(draft),
    ...(secret ? { api_key: secret } : {}),
  };
}

function routeSelection(route: ModelRouteDraft): LlmSelection["route"] {
  const routeId = requiredText(route.routeId, "Provider route");
  const label = optionalText(route.label);
  const baseUrl = optionalText(route.baseUrl);
  const apiKeyEnv = optionalText(route.apiKeyEnv);
  const apiType = optionalText(route.apiType) ?? "openai";
  return {
    route_id: routeId,
    ...(label ? { label } : {}),
    ...(baseUrl ? { base_url: baseUrl } : {}),
    api_key_env: apiKeyEnv ?? "",
    api_type: apiType,
  };
}

function safeTestResult(
  result: LlmTestResult,
  secret: string | undefined,
): ModelSettingsTestResult {
  return {
    profileId: result.profile_id,
    applied: result.applied,
    message: redactModelSettingsError(result.message, secret),
    error: result.error ? redactModelSettingsError(result.error, secret) : null,
  };
}

function safeMutationResult(
  result: LlmUpsertResult | ProfileLlmDeleteResult,
): ModelSettingsMutationResult {
  return {
    profileId: result.profile_id,
    applied: result.applied,
  };
}

function configurationFromDelete(
  result: ProfileLlmDeleteResult,
): ProfileLlmConfigResult {
  return {
    profile_id: result.profile_id,
    primary: result.primary,
    fallbacks: result.fallbacks,
  };
}

function fetchFailureMessage(reason: string): string {
  if (reason === "no_api_key") return "Add an API key before checking models.";
  if (reason === "provider_unavailable") {
    return "The provider did not return an available-model catalog.";
  }
  return `Could not check provider models: ${redactModelSettingsError(reason)}`;
}

function assertProfile(received: string, expected: string): void {
  if (received !== expected) {
    throw new Error("The model settings response belongs to another profile.");
  }
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  if (normalized.length > 4_096) throw new Error(`${label} is too long.`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length > 4_096) throw new Error("Model setting is too long.");
  return normalized;
}

function normalizedSecret(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

type Settled<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown }
  | { status: "skipped" };

async function settle<T>(promise: Promise<T>): Promise<Settled<T>> {
  try {
    return { status: "fulfilled", value: await promise };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}
