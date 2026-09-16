/**
 * Model-selection notices: the runtime disposition of a `profile/llm/select`
 * and the notice board the shell renders from it.
 *
 * Pure projections with no client or controller dependency, so the shell can
 * show "Restart required" without loading `ModelSettingsController` and the
 * whole model-management surface behind it.
 */

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
