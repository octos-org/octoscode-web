import { useSyncExternalStore } from "react";
import type {
  SnapshotList,
  WorkspaceSnapshot,
} from "@octos-org/octoscode-client/history";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import { browserStorage, type StorageLike } from "../connection/preferences.ts";
import {
  historySupported,
  type HistoryBinding,
  type HistoryMutation,
} from "./history-binding.ts";

/**
 * "Undo this turn" for the latest turn: Core's `pre-turn <turn_id>` snapshot
 * puts the workspace back to how it was before the turn; the `pre-restore`
 * snapshot that restore takes is the way back ("redo"). Only Core's answers
 * move this state. The undone turn, the point to return to and the points
 * this tab's own restores took are kept for the tab (sessionStorage) so a
 * reload can still offer the way back, and are checked against
 * `snapshot/list` before they are shown or used.
 *
 * T-0465: an action is offered only while Core lists nothing newer than its
 * anchor (the turn's `pre-turn` point to undo, the `pre-restore` point to
 * redo) that this tab did not make. Anything else newer — another tab's
 * restore, another Session's turn, a restore whose answer never arrived —
 * means the files are no longer what this page last saw, so it says so
 * instead of guessing what an undo or redo would now do.
 */
export type TurnUndoAction = "undo" | "redo";

export interface TurnUndoFailure {
  action: TurnUndoAction;
  /**
   * blocked: this page held the request back (work still running);
   * gone: the point to restore is no longer listed, nothing was sent;
   * moved: Core lists newer points this tab did not make, nothing was sent;
   * unsent: the check before sending failed, nothing was sent;
   * conflict: Core refused, saying files were edited (structured reason);
   * running: Core refused, saying a turn is running (structured reason);
   * refused: Core answered with another (or an unclassified) error;
   * uncertain: sent, but no answer arrived;
   * refresh: Core finished, the conversation refresh after it failed.
   */
  kind:
    | "blocked"
    | "gone"
    | "moved"
    | "unsent"
    | "conflict"
    | "running"
    | "refused"
    | "uncertain"
    | "refresh";
  /** Core's or the page's own words, shown as they are. */
  detail: string;
}

export interface TurnUndoView {
  /**
   * hidden: nothing to offer (methods not advertised, snapshots off or not
   * available, or the list could not be read); missing: snapshots are on but
   * Core kept no undo point for this turn; moved: Core lists newer points
   * this tab did not make, so what an undo or redo would do is unknown.
   */
  status: "checking" | "hidden" | "missing" | "ready" | "undone" | "moved";
  busy: TurnUndoAction | null;
  failure: TurnUndoFailure | null;
  /** The last action Core confirmed. */
  done: TurnUndoAction | null;
  /**
   * Undone: whether the way back is offered. gone: the state before the
   * undo is no longer listed; unclear: Core's answer did not single it out.
   */
  redo: "ok" | "gone" | "unclear";
}

export type TurnUndoSource = () => Promise<HistoryBinding>;

interface TurnRecord {
  turnId: string;
  /**
   * This tab undid the turn and has not redone it: the `pre-restore` point
   * its undo took (the way back), or null when Core's answer did not single
   * one out.
   */
  undone: { back: string | null } | null;
  /** The points this tab's own restores of the turn took. */
  own: string[];
}

const STORAGE_KEY = "octoscode.web.turn-undo.v1";
const MAX_RECORDS = 50;
const INITIAL: TurnUndoView = {
  status: "checking",
  busy: null,
  failure: null,
  done: null,
  redo: "ok",
};
/** Core's snapshots before each mutating tool batch inside a turn. */
const TOOL_POINT = /^pre-tool:/;

class TurnUndoController {
  readonly #scope: string;
  readonly #turnId: string;
  readonly #storage: () => StorageLike;
  readonly #listeners = new Set<() => void>();
  #source: TurnUndoSource | null = null;
  #onSettled: (() => void) | null = null;
  #ticket = 0;
  #view: TurnUndoView = INITIAL;

  constructor(scope: string, turnId: string, storage: () => StorageLike) {
    this.#scope = scope;
    this.#turnId = turnId;
    this.#storage = storage;
  }

  get view(): TurnUndoView {
    return this.#view;
  }

  /** This tab undid this turn and has not redone it. No request involved. */
  undone(): boolean {
    return Boolean(this.#recall()?.undone);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The page's current way to reach the owning Session, and what to refresh after. */
  attach(source: TurnUndoSource, onSettled: () => void): void {
    this.#source = source;
    this.#onSettled = onSettled;
  }

  async load(): Promise<void> {
    if (this.#view.busy || !this.#source) return;
    const ticket = ++this.#ticket;
    try {
      const binding = await this.#source();
      if (!historySupported(binding.capabilities, "undo")) {
        if (ticket === this.#ticket) this.#publish({ status: "hidden" });
        return;
      }
      const list = await (await binding.commands()).listSnapshots();
      if (ticket === this.#ticket && !this.#view.busy) this.#show(list);
    } catch {
      // No list, no claim: an unreadable server offers nothing to undo.
      if (ticket === this.#ticket && !this.#view.busy)
        this.#publish({ status: "hidden" });
    }
  }

  async run(action: TurnUndoAction): Promise<void> {
    // Synchronous single flight: a second click lands here before any await.
    if (this.#view.busy || !this.#source) return;
    if (
      action === "undo"
        ? this.#view.status !== "ready"
        : this.#view.status !== "undone"
    )
      return;
    this.#ticket += 1;
    this.#publish({ busy: action, failure: null, done: null });
    let lease: HistoryMutation | null = null;
    let submitted = false;
    let failure: TurnUndoFailure | null = null;
    let fresh: SnapshotList | null = null;
    try {
      const binding = await this.#source();
      try {
        lease = binding.acquire("undo");
      } catch (cause) {
        failure = { action, kind: "blocked", detail: errorText(cause) };
        return;
      }
      const commands = await binding.commands();
      fresh = await commands.listSnapshots();
      if (!lease.isCurrent())
        throw new Error("The Session changed. Try again.");
      const state = this.#state(fresh);
      const record = this.#recall();
      const target =
        action === "undo"
          ? state.status === "ready"
            ? this.#point(fresh)
            : null
          : state.status === "undone" && state.redo === "ok"
            ? (record?.undone?.back ?? null)
            : null;
      if (!target) {
        this.#publish(state);
        failure =
          state.status === "moved"
            ? {
                action,
                kind: "moved",
                detail:
                  "Not sent: Core lists newer saved states than this page made, so the files may not be what this page last saw. No files were changed.",
              }
            : {
                action,
                kind: "gone",
                detail:
                  action === "undo"
                    ? "This turn's undo point is no longer on the server. No files were changed."
                    : "The state before the undo is no longer on the server. No files were changed.",
              };
        return;
      }
      const blocked = binding.blockedReason("undo");
      if (blocked) {
        failure = { action, kind: "blocked", detail: blocked };
        return;
      }
      submitted = true;
      const response = await commands.restoreSnapshot(target);
      // Core restored: record what this restore took before anything else
      // can fail. Its `pre-restore` point is the one listed above the newest
      // point this tab saw before sending; anything else would be a guess.
      const taken = takenPoint(fresh, response.snapshots);
      const own = [...(record?.own ?? []), ...(taken ? [taken] : [])];
      this.#remember({
        turnId: this.#turnId,
        undone: action === "undo" ? { back: taken } : null,
        own,
      });
      this.#publish({
        status: action === "undo" ? "undone" : "ready",
        redo: action === "undo" && !taken ? "unclear" : "ok",
        done: action,
      });
      try {
        await lease.rehydrate();
      } catch (cause) {
        failure = { action, kind: "refresh", detail: errorText(cause) };
      }
    } catch (cause) {
      if (!submitted)
        failure = { action, kind: "unsent", detail: errorText(cause) };
      else if (cause instanceof OctosUiProtocolError) {
        failure = {
          action,
          kind: refusalKind(cause),
          detail: errorText(cause),
        };
        // Core records the current state before it refuses a conflicting or
        // failing restore: that point is this tab's own (read, not a retry).
        if (fresh) await this.#adoptRefused(fresh);
      } else {
        // Sent and unanswered: the files may or may not have changed. Never
        // replay; refresh what can be refreshed, read Core's list again (a
        // read, not a retry) and say so.
        failure = { action, kind: "uncertain", detail: errorText(cause) };
        try {
          if (lease?.isCurrent()) {
            await lease.rehydrate();
            const binding = await this.#source();
            this.#publish(
              this.#state(await (await binding.commands()).listSnapshots()),
            );
          }
        } catch {
          // The engine marks a failed canonical refresh unready; a reconnect
          // reads the list again.
        }
      }
    } finally {
      lease?.release();
      this.#publish({ busy: null, failure });
      if (submitted) this.#onSettled?.();
    }
  }

  async #adoptRefused(before: SnapshotList): Promise<void> {
    try {
      if (!this.#source) return;
      const binding = await this.#source();
      const after = await (await binding.commands()).listSnapshots();
      const taken = takenPoint(before, after.snapshots);
      const record = this.#recall();
      if (taken)
        this.#remember({
          turnId: this.#turnId,
          undone: record?.undone ?? null,
          own: [...(record?.own ?? []), taken],
        });
      this.#publish(this.#state(after));
    } catch {
      // The next load reads the list again.
    }
  }

  /** This turn's own undo point, if Core lists it. */
  #point(list: SnapshotList): string | null {
    return (
      list.snapshots.find((snapshot) => snapshot.turn_id === this.#turnId)
        ?.id ?? null
    );
  }

  /** What Core's list lets this page offer for the turn. */
  #state(list: SnapshotList): Pick<TurnUndoView, "status" | "redo"> {
    if (!list.enabled || !list.available)
      return { status: "hidden", redo: "ok" };
    const record = this.#recall();
    const own = record?.own ?? [];
    const point = this.#point(list);
    if (point && foreignAbove(list, point, own))
      return { status: "moved", redo: "ok" };
    const undone = record?.undone;
    if (undone) {
      const back = undone.back;
      if (back === null) return { status: "undone", redo: "unclear" };
      if (!list.snapshots.some((snapshot) => snapshot.id === back))
        return { status: "undone", redo: "gone" };
      return foreignAbove(list, back, own)
        ? { status: "moved", redo: "ok" }
        : { status: "undone", redo: "ok" };
    }
    return { status: point ? "ready" : "missing", redo: "ok" };
  }

  #show(list: SnapshotList): void {
    this.#publish(this.#state(list));
  }

  #recall(): TurnRecord | null {
    const record = readRecords(this.#storage())[this.#scope];
    return record?.turnId === this.#turnId ? record : null;
  }

  #remember(record: TurnRecord): void {
    const records = readRecords(this.#storage());
    delete records[this.#scope];
    const kept = Object.entries(records).slice(-(MAX_RECORDS - 1));
    writeRecords(this.#storage(), {
      ...Object.fromEntries(kept),
      [this.#scope]: record,
    });
    notifySessions();
  }

  #publish(patch: Partial<TurnUndoView>): void {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

/**
 * The `pre-restore` point a restore took: the one Core lists above the newest
 * point this page saw before sending. None (Core reused an identical state)
 * or several (another restore at the same time) single nothing out.
 */
function takenPoint(
  before: SnapshotList,
  after: readonly WorkspaceSnapshot[],
): string | null {
  const newest = before.snapshots[0]?.id;
  const index = after.findIndex((snapshot) => snapshot.id === newest);
  const above = (index < 0 ? after : after.slice(0, index)).filter(
    (snapshot) => snapshot.label === "pre-restore",
  );
  return above.length === 1 ? above[0]!.id : null;
}

/**
 * Whether Core lists, newer than `anchor`, a point this tab did not make.
 * The list is newest first; points Core takes before tool calls belong to the
 * turn that made them, and another turn has its own `pre-turn` point.
 */
function foreignAbove(
  list: SnapshotList,
  anchor: string,
  own: readonly string[],
): boolean {
  const index = list.snapshots.findIndex((snapshot) => snapshot.id === anchor);
  return list.snapshots
    .slice(0, Math.max(0, index))
    .some(
      (snapshot) =>
        !own.includes(snapshot.id) && !TOOL_POINT.test(snapshot.label),
    );
}

/**
 * Core's structured refusal reason (T-0467, `data.reason`), when it sends
 * one. Without it every refusal reads as Core's own words: the message text
 * is never parsed for a reason.
 */
function refusalKind(cause: OctosUiProtocolError): TurnUndoFailure["kind"] {
  const data = cause.data;
  const reason =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as { reason?: unknown }).reason
      : undefined;
  return reason === "files_edited"
    ? "conflict"
    : reason === "turn_running"
      ? "running"
      : "refused";
}

function readRecords(storage: StorageLike): Record<string, TurnRecord> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([scope, value]) => {
        const record = turnRecord(value);
        return record ? [[scope, record]] : [];
      }),
    );
  } catch {
    return {};
  }
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

function turnRecord(value: unknown): TurnRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!nonEmpty(raw.turnId)) return null;
  // The first shape kept only an undone turn and its way back.
  if (nonEmpty(raw.back))
    return { turnId: raw.turnId, undone: { back: raw.back }, own: [raw.back] };
  const own = Array.isArray(raw.own) ? raw.own.filter(nonEmpty) : [];
  const undone = raw.undone as { back?: unknown } | null | undefined;
  return {
    turnId: raw.turnId,
    undone:
      undone && typeof undone === "object"
        ? { back: nonEmpty(undone.back) ? undone.back : null }
        : null,
    own,
  };
}

function writeRecords(
  storage: StorageLike,
  records: Record<string, TurnRecord>,
): void {
  try {
    if (Object.keys(records).length)
      storage.setItem(STORAGE_KEY, JSON.stringify(records));
    else storage.removeItem(STORAGE_KEY);
  } catch {
    // A full or denied store only costs the way back after a reload.
  }
}

function errorText(cause: unknown): string {
  return (cause instanceof Error ? cause.message : "The request failed.").slice(
    0,
    512,
  );
}

/**
 * One controller per Session and turn, kept for the tab: a remount (a
 * reconnect, a session switch and back) finds the same state and any restore
 * still in flight.
 */
const controllers = new Map<string, TurnUndoController>();

export function turnUndoController(
  scope: string,
  turnId: string,
  storage: () => StorageLike = () => browserStorage("sessionStorage"),
): TurnUndoController {
  const key = JSON.stringify([scope, turnId]);
  let controller = controllers.get(key);
  if (!controller) {
    controller = new TurnUndoController(scope, turnId, storage);
    controllers.set(key, controller);
  }
  return controller;
}

/** Tests only. */
export function resetTurnUndoControllers(): void {
  controllers.clear();
}

const sessionListeners = new Set<() => void>();
function notifySessions(): void {
  for (const listener of sessionListeners) listener();
}
function subscribeSessions(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}

/**
 * Whether this tab undid the Session's latest turn and has not redone it (no
 * request involved). An undo of an earlier turn says nothing about the files
 * now: later turns have changed them since.
 */
export function useSessionTurnUndone(
  scope: string | null,
  latestTurnId: string | null,
  storage: () => StorageLike = () => browserStorage("sessionStorage"),
): boolean {
  return useSyncExternalStore(
    subscribeSessions,
    () => {
      if (!scope || !latestTurnId) return false;
      const record = readRecords(storage())[scope];
      return record?.turnId === latestTurnId && record.undone !== null;
    },
    () => false,
  );
}

export function useTurnUndo(controller: TurnUndoController): TurnUndoView {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.view,
    () => controller.view,
  );
}

export type { TurnUndoController };
