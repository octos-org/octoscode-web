import { randomUUID } from "../../shared/uuid.ts";
import {
  MAX_UPLOAD_BYTES,
  uploadedHandleForProfile,
  type TurnMedia,
} from "@octos-org/octoscode-client/media";

export const MAX_TURN_FILES = 10;
export const MAX_TURN_IMAGES = 4;
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_MIME: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
// Decided by extension, not by the browser's type: Windows reports a .csv as
// application/vnd.ms-excel wherever Excel is installed, and .md often as "".
const DOCUMENT_MIME: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  html: "text/html",
  htm: "text/html",
  xml: "text/xml",
  yaml: "text/yaml",
  yml: "text/yaml",
  ...Object.fromEntries(
    [
      "txt",
      "log",
      "jsonl",
      "toml",
      "ini",
      "sql",
      "py",
      "js",
      "ts",
      "css",
      "sh",
    ].map((extension) => [extension, "text/plain"]),
  ),
};
/** Office formats are out by product decision, so they get their own answer. */
const OFFICE_EXTENSION =
  /^(docx?|docm|xlsx?|xlsm|xlsb|pptx?|pptm|odt|ods|odp|rtf|wps|et|dps)$/;

/** Opaque authenticated runtime identity; never put a credential in this key. */
export interface AttachmentScope {
  readonly authorityKey: string;
  readonly sessionId: string;
  readonly profileId: string;
}
export interface AttachmentUploadCommands {
  upload(file: File, signal?: AbortSignal): Promise<TurnMedia>;
}
export interface AttachmentDraft {
  readonly id: string;
  readonly name: string;
  readonly bytes: number;
  readonly mime: string;
  readonly status: "selected" | "uploading" | "ready" | "error";
  readonly error: string | null;
}
export type AttachmentRejection =
  "office" | "unsupported" | "empty" | "too-large" | "too-many";
export interface RejectedAttachment {
  readonly name: string;
  readonly reason: AttachmentRejection;
}
export interface AttachmentSnapshot {
  readonly entries: readonly AttachmentDraft[];
  readonly uploading: boolean;
  readonly disposed: boolean;
}
interface Entry {
  draft: AttachmentDraft;
  file: File | null;
  media: TurnMedia | null;
}

function attachmentMime(file: File): string | AttachmentRejection {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1]?.toLowerCase() ?? "";
  if (OFFICE_EXTENSION.test(extension)) return "office";
  const image = IMAGE_MIME[extension];
  const mime = image ?? DOCUMENT_MIME[extension];
  if (!mime || (image && file.type && file.type.toLowerCase() !== image))
    return "unsupported";
  if (!file.size) return "empty";
  if (file.size > (image ? MAX_IMAGE_BYTES : MAX_UPLOAD_BYTES))
    return "too-large";
  return mime;
}

/**
 * Keep ONE store on each persistent Session
 * record. Selection never reads a path. Files live only in this bounded,
 * in-memory draft; no storage, previews, object URLs or credentials.
 * Keep the store on ordinary Session switches; invalidate it when its full
 * authenticated runtime authority is retired. Do not move drafts across scopes.
 */
export class AttachmentDraftStore {
  readonly scope: AttachmentScope;
  readonly uploadAvailable: boolean;
  readonly #options: {
    commands(): Promise<AttachmentUploadCommands>;
    isCurrent(): boolean;
  };
  readonly #entries = new Map<string, Entry>();
  readonly #uploads = new Map<string, AbortController>();
  readonly #listeners = new Set<() => void>();
  #disposed = false;
  #snapshot: AttachmentSnapshot = Object.freeze({
    entries: Object.freeze([]),
    uploading: false,
    disposed: false,
  });

  constructor(options: {
    scope: AttachmentScope;
    /** Capture the owning authority's negotiated TURN_START gate; defaults closed. */
    uploadAvailable?: boolean;
    /** Root supplies its lazy, capability-gated client.mediaCommands factory. */
    commands(): Promise<AttachmentUploadCommands>;
    /** Checks the owning record, not whichever Session happens to be selected. */
    isCurrent(): boolean;
  }) {
    if (Object.values(options.scope).some((value) => !value.trim()))
      throw new Error(
        "A confirmed attachment authority, Profile and Session are required.",
      );
    this.scope = Object.freeze({ ...options.scope });
    this.uploadAvailable = options.uploadAvailable === true;
    this.#options = options;
  }

  getSnapshot = (): AttachmentSnapshot => this.#snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #publish(): void {
    this.#snapshot = Object.freeze({
      entries: Object.freeze(
        [...this.#entries.values()].map((entry) => entry.draft),
      ),
      uploading: this.#uploads.size > 0,
      disposed: this.#disposed,
    });
    for (const listener of this.#listeners) listener();
  }

  #assertCurrent(): void {
    if (!this.#disposed && this.#options.isCurrent()) return;
    this.invalidate();
    throw new Error(
      "This attachment draft no longer belongs to a current Session authority.",
    );
  }

  /**
   * Stage what can be attached and report the rest, so one unsupported file in
   * a dropped batch does not cost the others. No bytes are read or sent here.
   */
  selectFiles(files: readonly File[]): RejectedAttachment[] {
    this.#assertCurrent();
    if (!this.uploadAvailable)
      throw new Error("File uploads are unavailable on this server.");
    const drafts = [...this.#entries.values()].map((entry) => entry.draft);
    // Re-adding a draft already on this Session is an idempotent no-op; only a
    // genuinely new (name, size, mime) triple becomes a draft.
    const seen = new Set(
      drafts.map((draft) =>
        JSON.stringify([draft.name, draft.bytes, draft.mime]),
      ),
    );
    let count = drafts.length;
    let images = drafts.filter((draft) =>
      draft.mime.startsWith("image/"),
    ).length;
    const rejected: RejectedAttachment[] = [];
    let added = false;
    for (const file of files) {
      const mime = attachmentMime(file);
      if (!mime.includes("/")) {
        rejected.push({
          name: file.name,
          reason: mime as AttachmentRejection,
        });
        continue;
      }
      const key = JSON.stringify([file.name, file.size, mime]);
      if (seen.has(key)) continue;
      const image = mime.startsWith("image/");
      if (count >= MAX_TURN_FILES || (image && images >= MAX_TURN_IMAGES)) {
        rejected.push({ name: file.name, reason: "too-many" });
        continue;
      }
      seen.add(key);
      added = true;
      count += 1;
      if (image) images += 1;
      const id = randomUUID();
      this.#entries.set(id, {
        draft: Object.freeze({
          id,
          name: file.name,
          bytes: file.size,
          mime,
          status: "selected",
          error: null,
        }),
        // The upload receipt must carry the normalized type, whatever the
        // browser reported for this file.
        file:
          file.type === mime
            ? file
            : new File([file], file.name, {
                type: mime,
                lastModified: file.lastModified,
              }),
        media: null,
      });
    }
    if (added) this.#publish();
    return rejected;
  }

  /** Upload only selected/failed entries; same-tick repeated clicks cannot duplicate work. */
  async uploadSelected(): Promise<void> {
    this.#assertCurrent();
    if (!this.uploadAvailable)
      throw new Error("File uploads are unavailable on this server.");
    const selected = [...this.#entries.entries()].filter(
      ([, entry]) =>
        entry.draft.status === "selected" || entry.draft.status === "error",
    );
    await Promise.all(selected.map(([id, entry]) => this.#upload(id, entry)));
  }

  async #upload(id: string, entry: Entry): Promise<void> {
    const file = entry.file;
    if (!file || this.#uploads.has(id)) return;
    const abort = new AbortController();
    this.#uploads.set(id, abort);
    entry.draft = Object.freeze({
      ...entry.draft,
      status: "uploading",
      error: null,
    });
    this.#publish();
    const current = () => {
      if (!this.#options.isCurrent()) this.invalidate();
      return (
        !this.#disposed &&
        !abort.signal.aborted &&
        this.#uploads.get(id) === abort &&
        this.#entries.get(id) === entry
      );
    };
    try {
      const commands = await this.#options.commands();
      if (!current()) return;
      const media = await commands.upload(file, abort.signal);
      if (!current()) return;
      if (
        !uploadedHandleForProfile(media.path, this.scope.profileId) ||
        media.mime !== entry.draft.mime ||
        media.size_bytes !== file.size
      )
        throw new Error("Invalid attachment receipt");
      entry.media = {
        path: media.path,
        mime: media.mime,
        size_bytes: media.size_bytes,
      };
      entry.file = null;
      entry.draft = Object.freeze({
        ...entry.draft,
        status: "ready",
        error: null,
      });
    } catch {
      if (!current()) return;
      // Never expose transport messages: they may contain secrets/private paths.
      entry.draft = Object.freeze({
        ...entry.draft,
        status: "error",
        error: "Upload failed. Retry it or remove it.",
      });
    } finally {
      if (this.#uploads.get(id) === abort) {
        this.#uploads.delete(id);
        this.#publish();
      }
    }
  }

  cancelUploads(): void {
    for (const [id, abort] of this.#uploads) {
      abort.abort();
      const entry = this.#entries.get(id);
      if (entry)
        entry.draft = Object.freeze({
          ...entry.draft,
          status: "selected",
          error: null,
        });
    }
    this.#uploads.clear();
    this.#publish();
  }

  /** Removes the local draft reference only; never deletes a server file. */
  remove(id: string): void {
    this.#uploads.get(id)?.abort();
    this.#uploads.delete(id);
    this.#entries.delete(id);
    this.#publish();
  }

  /**
   * Call ONLY at an accepted local queue-enqueue boundary, after text/media
   * validation. The caller must attach this returned batch to that immutable
   * turn, not read the current draft later when the queued turn starts.
   */
  takeForTurn(expectedScope: AttachmentScope): TurnMedia[] {
    const media = this.#validatedMedia(expectedScope);
    this.#entries.clear();
    this.#publish();
    return media;
  }

  /** Synchronous local admission: rejected queues keep the complete draft. */
  submitTurn(
    expectedScope: AttachmentScope,
    admit: (media: TurnMedia[]) => boolean,
  ): boolean {
    const media = this.#validatedMedia(expectedScope);
    if (!admit(media)) return false;
    this.#entries.clear();
    this.#publish();
    return true;
  }

  /** Return this record's already-uploaded turn media without uploading again. */
  restoreUploaded(media: readonly TurnMedia[]): boolean {
    this.#assertCurrent();
    if (this.#entries.size) return false;
    if (
      media.some(
        (item) => !uploadedHandleForProfile(item.path, this.scope.profileId),
      )
    )
      throw new Error("Attachments belong to another Profile.");
    for (const item of media) {
      const id = randomUUID();
      this.#entries.set(id, {
        draft: Object.freeze({
          id,
          name: item.path.split("/")[2]!,
          bytes: item.size_bytes,
          mime: item.mime,
          status: "ready",
          error: null,
        }),
        file: null,
        media: { ...item },
      });
    }
    this.#publish();
    return true;
  }

  #validatedMedia(expectedScope: AttachmentScope): TurnMedia[] {
    this.#assertCurrent();
    if (
      expectedScope.authorityKey !== this.scope.authorityKey ||
      expectedScope.sessionId !== this.scope.sessionId ||
      expectedScope.profileId !== this.scope.profileId
    )
      throw new Error("Attachments belong to another Session authority.");
    if (
      [...this.#entries.values()].some(
        (entry) => entry.draft.status !== "ready" || !entry.media,
      )
    )
      throw new Error(
        "Upload or remove every selected file before sending this turn.",
      );
    const media = [...this.#entries.values()].map((entry) => ({
      ...entry.media!,
    }));
    return media;
  }

  /** Auth retirement/disposal: abort work and release every retained local File. */
  invalidate(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const abort of this.#uploads.values()) abort.abort();
    this.#uploads.clear();
    this.#entries.clear();
    this.#publish();
  }
}
