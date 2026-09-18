import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type TurnMedia,
} from "@octos-org/octoscode-client/protocol";
import { reasoningEffort, type ReasoningEffort } from "../reasoning/model.ts";
import type { AttachmentDraftStore } from "../media/attachment-drafts.ts";
import type { SessionRecord } from "./session-record-manager.ts";
import { sessionRuntimeScopeKey } from "./session-scope.ts";
import type { PromptTurn } from "../composer/turn-queue.ts";

export type ComposerRestore = { text: string } | PromptTurn;

type Record = SessionRecord<OctosUiClient>;
interface Draft {
  effort: ReasoningEffort | undefined;
  showReasoning: boolean;
  images: AttachmentDraftStore | null;
  loading: Promise<AttachmentDraftStore | null> | null;
  error: string | null;
}

/** Browser-only input state. Queued prompts capture it; selection never moves it. */
export class SessionComposerDrafts {
  readonly #drafts = new Map<Record, Draft>();
  /** Returned inputs stay in order on their owning authenticated record. */
  readonly #restores = new Map<Record, ComposerRestore[]>();
  constructor(
    private readonly options: {
      isRetained(record: Record): boolean;
      changed(): void;
    },
  ) {}

  get(record: Record): Draft {
    let draft = this.#drafts.get(record);
    if (!draft) {
      draft = {
        effort: reasoningEffort(record.payload?.opened.reasoning_effort),
        showReasoning: true,
        images: null,
        loading: null,
        error: null,
      };
      this.#drafts.set(record, draft);
    }
    return draft;
  }
  setEffort(record: Record, value: ReasoningEffort | undefined): void {
    if (!this.options.isRetained(record)) return;
    this.get(record).effort = reasoningEffort(value);
    this.options.changed();
  }
  setShowReasoning(record: Record, visible: boolean): void {
    if (!this.options.isRetained(record)) return;
    this.get(record).showReasoning = visible;
    this.options.changed();
  }
  async prepareImages(record: Record): Promise<AttachmentDraftStore | null> {
    if (!this.options.isRetained(record)) return null;
    const draft = this.get(record);
    if (draft.images) return draft.images;
    if (draft.loading) return draft.loading;
    const authority = record.runtime.currentAuthority();
    if (
      !authority ||
      !supportsMethod(authority.capabilities, CORE_UI_METHODS.TURN_START)
    )
      return null;
    const current = () =>
      this.options.isRetained(record) && this.#drafts.get(record) === draft;
    draft.loading = import("../media/attachment-drafts.ts")
      .then(({ AttachmentDraftStore }) => {
        if (!current()) return null;
        const store = new AttachmentDraftStore({
          scope: {
            authorityKey: sessionRuntimeScopeKey(record.scope),
            sessionId: record.scope.sessionId,
            profileId: record.scope.profileId,
          },
          uploadAvailable: true,
          isCurrent: current,
          commands: async () => {
            const live = record.runtime.currentAuthority();
            if (
              !current() ||
              !live?.capabilities ||
              live.client.status !== "connected" ||
              record.runtime.getSnapshot().phase !== "ready"
            )
              throw new Error("Session upload authority is unavailable.");
            const commands = await live.client.mediaCommands(
              record.scope.sessionId,
              record.scope.profileId,
              live.capabilities,
            );
            if (!current() || !record.runtime.isCurrent(live))
              throw new Error("Session upload authority changed.");
            return commands;
          },
        });
        draft.images = store;
        store.subscribe(this.options.changed);
        return store;
      })
      .catch(() => {
        if (current())
          draft.error = "Image controls could not be loaded. Try again.";
        return null;
      })
      .finally(() => {
        if (current()) {
          draft.loading = null;
          this.options.changed();
        }
      });
    return draft.loading;
  }
  /**
   * Gap 9: the turn controller reports a user interrupt's stashed prompt back
   * when THAT turn's own terminal lands. Park it on the owning record so the
   * Session it came from — not whichever Session is now selected — gets it.
   */
  restoreInterruptPrompt(record: Record, prompt: string): void {
    if (!this.options.isRetained(record) || !prompt) return;
    this.#parkRestore(record, { text: prompt });
  }
  restoreUnsentTurn(record: Record, turn: PromptTurn): void {
    if (!this.options.isRetained(record)) return;
    this.#parkRestore(record, {
      ...turn,
      ...(turn.media
        ? { media: turn.media.map((media) => ({ ...media })) }
        : {}),
    });
  }
  #parkRestore(record: Record, restore: ComposerRestore): void {
    const pending = this.#restores.get(record) ?? [];
    pending.push(restore);
    this.#restores.set(record, pending);
    this.options.changed();
  }
  /** The pending restore for a record without draining it. */
  peekRestore(record: Record): ComposerRestore | null {
    return this.#restores.get(record)?.[0] ?? null;
  }
  /** Caller has checked that this record's text is empty; never replace new images. */
  consumeRestore(record: Record): string | null {
    if (!this.options.isRetained(record)) return null;
    const pending = this.#restores.get(record);
    const restore = pending?.[0];
    if (!restore) return null;
    const draft = this.get(record);
    if (draft.images?.getSnapshot().entries.length) return null;
    if ("turnId" in restore) {
      // A media-bearing composer submission already owns an image store. Its
      // handles were consumed at local admission, not at the later wire send.
      if (restore.media?.length) draft.images!.restoreUploaded(restore.media);
      draft.effort = reasoningEffort(restore.reasoningEffort);
    }
    pending!.shift();
    if (!pending!.length) this.#restores.delete(record);
    this.options.changed();
    return restore.text;
  }
  enqueue(record: Record, text: string): boolean {
    if (!this.options.isRetained(record)) return false;
    const draft = this.get(record);
    const admit = (media: TurnMedia[]) =>
      record.controller.submitTurn({
        turnId: crypto.randomUUID(),
        text,
        ...(draft.effort ? { reasoningEffort: draft.effort } : {}),
        ...(media.length ? { media } : {}),
      });
    try {
      const accepted = draft.images
        ? draft.images.submitTurn(draft.images.scope, admit)
        : admit([]);
      draft.error = accepted
        ? null
        : "This Session cannot accept the prompt now. Your draft was kept.";
      this.options.changed();
      return accepted;
    } catch {
      draft.error =
        "Upload or remove every selected image before sending. Your draft was kept.";
      this.options.changed();
      return false;
    }
  }
  suspendTransfers(): void {
    for (const draft of this.#drafts.values()) draft.images?.cancelUploads();
  }
  retire(record: Record): void {
    const draft = this.#drafts.get(record);
    this.#drafts.delete(record);
    this.#restores.delete(record);
    draft?.images?.invalidate();
  }
  clear(): void {
    for (const record of this.#drafts.keys()) this.retire(record);
    this.#restores.clear();
  }
}
