import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MEMORY_VERSION_CONFLICT_CODE,
  OctosUiProtocolError,
} from "@octos-org/octoscode-client/protocol";
import type {
  MemoryEntries as MemoryEntryList,
  MemoryEntry,
  MemoryEntryReceipt,
} from "@octos-org/octoscode-client/memory";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./MemorySettings.module.css";

/** Just the commands this list uses, so the page's commands fit unchanged. */
export interface MemoryEntryCommands {
  entries(): Promise<MemoryEntryList>;
  edit(entry: MemoryEntry, content: string): Promise<MemoryEntryReceipt>;
  delete(entry: MemoryEntry): Promise<MemoryEntryReceipt>;
}

interface MemoryEntriesProps {
  commands: () => Promise<MemoryEntryCommands>;
  canEdit: boolean;
  canDelete: boolean;
  /** Bumped by the page's Refresh: read the list again. */
  epoch: number;
  /** The page's other actions are running; take no new one. */
  disabled: boolean;
  /** Takes the page's single action slot; false when it is taken. */
  claim: (action: string) => boolean;
  release: () => void;
  /** After an edit or delete, kept or not: the page reads the rest again. */
  onChanged: () => void;
  /** Shown when the server lists no entries but holds long-term memory. */
  unlisted: ReactNode;
}

type Outcome = "conflict" | "missing" | "refused" | "uncertain";

/** What a failed edit or delete says about the server's copy. */
function outcome(reason: unknown): Outcome {
  if (!(reason instanceof OctosUiProtocolError)) return "uncertain";
  const data = reason.data as Record<string, unknown> | undefined;
  if (
    reason.code === MEMORY_VERSION_CONFLICT_CODE &&
    data?.kind === "version_conflict"
  ) {
    return "conflict";
  }
  if (data?.kind === "not_found" && data.resource_type === "memory_entry") {
    return "missing";
  }
  // Core refuses bad ids and content before it writes anything.
  return reason.code === -32_602 ? "refused" : "uncertain";
}

/**
 * Long-term memory as the server lists it, entry by entry, with edit and
 * delete when the server offers them. Every change is followed by a fresh
 * read: the list on screen is always the server's, never a local guess.
 */
export function MemoryEntries({
  commands,
  canEdit,
  canDelete,
  epoch,
  disabled,
  claim,
  release,
  onChanged,
  unlisted,
}: MemoryEntriesProps) {
  const t = useUiText();
  const [list, setList] = useState<MemoryEntryList | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ id: string; draft: string } | null>(
    null,
  );
  /** Text whose entry left the server before it could be saved. */
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [working, setWorking] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = useRef(commands);
  live.current = commands;

  /** The server's list, or why it couldn't be read; never a local edit. */
  const reload = async (): Promise<MemoryEntryList | null> => {
    try {
      const next = await (await live.current()).entries();
      setList(next);
      setStale(false);
      return next;
    } catch (reason) {
      setStale(true);
      setError(
        t("Couldn't read the memories again: {reason}", {
          reason: errorMessage(reason),
        }),
      );
      return null;
    }
  };

  useEffect(() => {
    let current = true;
    setLoading(true);
    void live
      .current()
      .then((ready) => ready.entries())
      .then(
        (next) => {
          if (!current) return;
          setList(next);
          setStale(false);
          setLoading(false);
        },
        (reason: unknown) => {
          if (!current) return;
          setStale(true);
          setError(errorMessage(reason));
          setLoading(false);
        },
      );
    return () => {
      current = false;
    };
  }, [epoch]);

  const busy = disabled || working !== null;

  const save = async (entry: MemoryEntry, draft: string) => {
    if (busy || !draft.trim() || !claim("memory-edit")) return;
    setWorking("save");
    setError(null);
    setNotice(null);
    try {
      await (await live.current()).edit(entry, draft);
      setEditing(null);
      // Said once the list is the server's again, not before.
      setNotice(
        (await reload())
          ? t("Saved. The list below is the server's copy.")
          : t("Saved."),
      );
    } catch (reason) {
      const kind = outcome(reason);
      const next = await reload();
      const still = next?.entries.some((item) => item.id === entry.id);
      if (kind === "missing" || (next && !still)) {
        setEditing(null);
        setUnsaved(draft);
        setError(
          t(
            "This memory is no longer on the server, so your text was not saved.",
          ),
        );
      } else if (kind === "conflict") {
        setError(
          t(
            "This memory changed on the server after it was loaded, so your text was not saved. Its text on the server is shown above yours, which is still in the editor. Save again to replace it.",
          ),
        );
      } else if (kind === "refused") {
        setError(t("Not saved: {reason}", { reason: errorMessage(reason) }));
      } else {
        setError(
          t(
            "The server didn't confirm the change ({reason}). Its text on the server is shown above yours, which is still in the editor.",
            { reason: errorMessage(reason) },
          ),
        );
      }
    } finally {
      setWorking(null);
      release();
      onChanged();
    }
  };

  const remove = async (entry: MemoryEntry) => {
    if (busy || !claim("memory-delete")) return;
    setWorking("delete");
    setError(null);
    setNotice(null);
    try {
      await (await live.current()).delete(entry);
      setConfirming(null);
      setNotice(
        (await reload())
          ? t("Deleted. The list below is the server's copy.")
          : t("Deleted."),
      );
    } catch (reason) {
      const kind = outcome(reason);
      setConfirming(null);
      await reload();
      setError(
        kind === "missing"
          ? t("This memory was already gone from the server.")
          : kind === "conflict"
            ? t(
                "This memory changed on the server after it was loaded, so it was not deleted. Check what it says now, and delete it again if you still want to.",
              )
            : kind === "refused"
              ? t("Not deleted: {reason}", { reason: errorMessage(reason) })
              : t(
                  "The server didn't confirm the delete ({reason}). The list shows what it holds now.",
                  { reason: errorMessage(reason) },
                ),
      );
    } finally {
      setWorking(null);
      release();
      onChanged();
    }
  };

  const entries = list?.entries ?? [];
  return (
    <details className={styles.document} open>
      <summary>{t("Long-term memory")}</summary>
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {stale && list ? (
        <p className={styles.meta}>
          {t(
            "This list may be out of date. Use Refresh to read it from the server.",
          )}
        </p>
      ) : null}
      {unsaved !== null ? (
        <div className={styles.form}>
          <label htmlFor="memory-unsaved">{t("Your unsaved text")}</label>
          <textarea id="memory-unsaved" rows={3} readOnly value={unsaved} />
          <div className={styles.actions}>
            <button type="button" onClick={() => setUnsaved(null)}>
              {t("Dismiss")}
            </button>
          </div>
        </div>
      ) : null}
      {list && !entries.length
        ? (unlisted ?? <p>{t("No long-term memories yet.")}</p>)
        : null}
      <ul className={styles.entries}>
        {entries.map((entry) => {
          const draft = editing?.id === entry.id ? editing.draft : null;
          return (
            <li key={entry.id} className={styles.entry}>
              {draft !== null ? (
                <form
                  className={styles.form}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save(entry, draft);
                  }}
                >
                  <p className={styles.meta}>
                    {t("On the server: {text}", { text: entry.body })}
                  </p>
                  <label htmlFor={`memory-edit-${entry.id}`}>
                    {t("Edit memory")}
                  </label>
                  <textarea
                    id={`memory-edit-${entry.id}`}
                    rows={3}
                    value={draft}
                    disabled={working === "save"}
                    onChange={(event) =>
                      setEditing({ id: entry.id, draft: event.target.value })
                    }
                  />
                  <div className={styles.actions}>
                    <button type="submit" disabled={busy || !draft.trim()}>
                      {working === "save" ? t("Saving…") : t("Save")}
                    </button>
                    <button
                      type="button"
                      disabled={working === "save"}
                      onClick={() => {
                        setEditing(null);
                        setError(null);
                      }}
                    >
                      {t("Cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <p className={styles.entryText}>{entry.body}</p>
              )}
              {draft === null && confirming !== entry.id ? (
                <div className={styles.actions}>
                  {canEdit ? (
                    <button
                      type="button"
                      disabled={busy || editing !== null}
                      onClick={() => {
                        setConfirming(null);
                        setError(null);
                        setNotice(null);
                        setEditing({ id: entry.id, draft: entry.body });
                      }}
                    >
                      {t("Edit")}
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      disabled={busy || editing !== null}
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setConfirming(entry.id);
                      }}
                    >
                      {t("Delete")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {confirming === entry.id ? (
                <div
                  className={styles.confirm}
                  role="group"
                  aria-label={t("Confirm delete")}
                >
                  <p>
                    {t(
                      "Delete this memory? Its archived copies go too, and it can't be undone.",
                    )}
                  </p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.danger}
                      disabled={busy}
                      onClick={() => void remove(entry)}
                    >
                      {working === "delete"
                        ? t("Deleting…")
                        : t("Delete memory")}
                    </button>
                    <button
                      type="button"
                      disabled={working === "delete"}
                      onClick={() => setConfirming(null)}
                    >
                      {t("Keep it")}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {list?.truncated ? (
        <p className={styles.meta}>
          {t(
            "Showing {shown} of {total} memories; the rest can't be edited here.",
            { shown: entries.length, total: list.total },
          )}
        </p>
      ) : null}
    </details>
  );
}
