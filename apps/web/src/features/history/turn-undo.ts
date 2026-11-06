import { useSyncExternalStore } from "react";
import type { SnapshotList } from "@octos-org/octoscode-client/history";
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
 * move this state. The undone turn, and the point to return to, are kept for
 * the tab (sessionStorage) so a reload can still offer the way back, and are
 * checked against `snapshot/list` before they are shown or used.
 */
export type TurnUndoAction = "undo" | "redo";

export interface TurnUndoFailure {
  action: TurnUndoAction;
  /**
   * blocked: this page held the request back (work still running);
   * gone: the point to restore is no longer listed, nothing was sent;
   * unsent: the check before sending failed, nothing was sent;
   * conflict: Core refused to overwrite files edited after the undo;
   * refused: Core answered with another error;
   * uncertain: sent, but no answer arrived;
   * refresh: Core finished, the conversation refresh after it failed.
   */
  kind:
    | "blocked"
    | "gone"
    | "unsent"
    | "conflict"
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
   * Core kept no undo point for this turn.
   */
  status: "checking" | "hidden" | "missing" | "ready" | "undone";
  busy: TurnUndoAction | null;
  failure: TurnUndoFailure | null;
  /** The last action Core confirmed. */
  done: TurnUndoAction | null;
  /** Undone, but the state before the undo is no longer listed. */
  redoGone: boolean;
}

export type TurnUndoSource = () => Promise<HistoryBinding>;

interface UndoneTurn {
  turnId: string;
  /** The `pre-restore` snapshot the undo took: the way back. */
  back: string;
}

const STORAGE_KEY = "octoscode.web.turn-undo.v1";
const MAX_RECORDS = 50;
const INITIAL: TurnUndoView = {
  status: "checking",
  busy: null,
  failure: null,
  done: null,
  redoGone: false,
};

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
    return this.#recall() !== null;
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
    try {
      const binding = await this.#source();
      try {
        lease = binding.acquire("undo");
      } catch (cause) {
        failure = { action, kind: "blocked", detail: errorText(cause) };
        return;
      }
      const commands = await binding.commands();
      const fresh = await commands.listSnapshots();
      if (!lease.isCurrent())
        throw new Error("The Session changed. Try again.");
      const target = this.#target(action, fresh);
      if (!target) {
        this.#show(fresh);
        failure = {
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
      // Core restored: record the way back before anything else can fail.
      if (action === "undo")
        this.#remember({
          turnId: this.#turnId,
          back: response.snapshots[0]?.id ?? target,
        });
      else this.#forget();
      this.#publish({
        status: action === "undo" ? "undone" : "ready",
        redoGone: false,
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
      else if (cause instanceof OctosUiProtocolError)
        failure = {
          action,
          kind: /restore refused/i.test(cause.message) ? "conflict" : "refused",
          detail: errorText(cause),
        };
      else {
        // Sent and unanswered: the files may or may not have changed. Never
        // replay; refresh what can be refreshed and say so.
        failure = { action, kind: "uncertain", detail: errorText(cause) };
        try {
          if (lease?.isCurrent()) await lease.rehydrate();
        } catch {
          // The engine marks a failed canonical refresh unready.
        }
      }
    } finally {
      lease?.release();
      this.#publish({ busy: null, failure });
      if (submitted) this.#onSettled?.();
    }
  }

  #target(action: TurnUndoAction, list: SnapshotList): string | null {
    if (!list.enabled || !list.available) return null;
    if (action === "undo")
      return (
        list.snapshots.find((snapshot) => snapshot.turn_id === this.#turnId)
          ?.id ?? null
      );
    const undone = this.#recall();
    return undone &&
      list.snapshots.some((snapshot) => snapshot.id === undone.back)
      ? undone.back
      : null;
  }

  #show(list: SnapshotList): void {
    if (!list.enabled || !list.available) {
      this.#publish({ status: "hidden" });
      return;
    }
    const undone = this.#recall();
    if (undone)
      this.#publish({
        status: "undone",
        redoGone: !list.snapshots.some(
          (snapshot) => snapshot.id === undone.back,
        ),
      });
    else
      this.#publish({
        status: list.snapshots.some(
          (snapshot) => snapshot.turn_id === this.#turnId,
        )
          ? "ready"
          : "missing",
        redoGone: false,
      });
  }

  #recall(): UndoneTurn | null {
    const record = readRecords(this.#storage())[this.#scope];
    return record?.turnId === this.#turnId ? record : null;
  }

  #remember(record: UndoneTurn): void {
    const records = readRecords(this.#storage());
    delete records[this.#scope];
    const kept = Object.entries(records).slice(-(MAX_RECORDS - 1));
    writeRecords(this.#storage(), {
      ...Object.fromEntries(kept),
      [this.#scope]: record,
    });
    notifySessions();
  }

  #forget(): void {
    const records = readRecords(this.#storage());
    if (!(this.#scope in records)) return;
    delete records[this.#scope];
    writeRecords(this.#storage(), records);
    notifySessions();
  }

  #publish(patch: Partial<TurnUndoView>): void {
    this.#view = { ...this.#view, ...patch };
    for (const listener of this.#listeners) listener();
  }
}

function readRecords(storage: StorageLike): Record<string, UndoneTurn> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, UndoneTurn] =>
          typeof entry[1]?.turnId === "string" &&
          typeof entry[1]?.back === "string" &&
          entry[1].turnId.length > 0 &&
          entry[1].back.length > 0,
      ),
    );
  } catch {
    return {};
  }
}

function writeRecords(
  storage: StorageLike,
  records: Record<string, UndoneTurn>,
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

/** Whether this tab holds an undone turn for the Session (no request involved). */
export function useSessionTurnUndone(
  scope: string | null,
  storage: () => StorageLike = () => browserStorage("sessionStorage"),
): boolean {
  return useSyncExternalStore(
    subscribeSessions,
    () => (scope ? scope in readRecords(storage()) : false),
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
