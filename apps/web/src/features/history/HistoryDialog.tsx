import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  validForkChatId,
  type WorkspaceSnapshot,
} from "@octos-org/octoscode-client/history";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import type { ConversationCheckpoint } from "./checkpoints.ts";
import type { HistoryBinding, HistoryMode } from "./history-binding.ts";
import { HistoryCoordinator } from "./history-coordinator.ts";
import styles from "./HistoryDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface HistoryDialogProps {
  mode: HistoryMode;
  binding: HistoryBinding;
  onClose: () => void;
}

/** Selection is presentation only; the binding owns every asynchronous result. */
export function HistoryDialog(props: HistoryDialogProps) {
  return (
    <BoundHistoryDialog
      key={`${props.binding.authorityKey}:${props.mode}`}
      {...props}
    />
  );
}

function BoundHistoryDialog({ mode, binding, onClose }: HistoryDialogProps) {
  const t = useUiText();
  const coordinator = useMemo(
    () => new HistoryCoordinator(binding, mode),
    [binding, mode],
  );
  const state = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot,
  );
  const { snapshots, checkpoints, loading, mutating, error, notice } = state;
  const sessionId = binding.scope.sessionId;
  const [selectedSnapshot, setSelectedSnapshot] =
    useState<WorkspaceSnapshot | null>(null);
  const [selectedCheckpoint, setSelectedCheckpoint] =
    useState<ConversationCheckpoint | null>(null);
  const [branchName, setBranchName] = useState("");
  const locked =
    Boolean(state.blockedReason) ||
    loading ||
    mutating ||
    state.completed ||
    state.uncertain ||
    state.canRetryRefresh;

  useEffect(() => {
    void coordinator.load();
    return () => coordinator.cancelLoad();
  }, [coordinator]);

  async function apply() {
    if (locked) return;
    if (mode === "undo" && selectedSnapshot)
      await coordinator.apply({ mode, snapshotId: selectedSnapshot.id });
    else if (mode === "rewind" && selectedCheckpoint)
      await coordinator.apply({ mode, checkpoint: selectedCheckpoint });
    else if (mode === "fork")
      await coordinator.apply({ mode, name: branchName });
    if (coordinator.getSnapshot().completed) {
      setSelectedSnapshot(null);
      setSelectedCheckpoint(null);
    }
  }

  const title =
    mode === "undo"
      ? "Undo workspace changes"
      : mode === "rewind"
        ? "Rewind conversation"
        : "Fork conversation";
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy="history-dialog-title"
      onEscape={() => {
        if (!mutating) onClose();
      }}
    >
      <header className={styles.header}>
        <h2 id="history-dialog-title">{t(title)}</h2>
        <button type="button" disabled={mutating} onClick={onClose}>
          {t("Close history")}
        </button>
      </header>
      <p className={styles.scope}>{sessionId}</p>
      <p>
        {mode === "undo"
          ? t(
              "Restore server-owned files to a saved snapshot. This can replace workspace changes; conversation messages are not rewound.",
            )
          : mode === "rewind"
            ? t(
                "Remove the selected user-rooted thread and all later user turns, then edit and resend its initial prompt. Workspace files and unthreaded system messages are not restored or removed.",
              )
            : t(
                "Copy the conversation into a new session in the same workspace. This does not create a Git worktree or a workspace copy.",
              )}
      </p>
      {loading ? <p role="status">{t("Loading server history…")}</p> : null}
      {state.blockedReason ? <p role="status">{state.blockedReason}</p> : null}
      {mutating ? (
        <p role="status">{t("Applying and refreshing the owning Session…")}</p>
      ) : null}
      {mode === "undo" ? (
        <div className={styles.rows}>
          {snapshots && !snapshots.enabled ? (
            <p>
              {t(
                "Automatic snapshots are disabled. Existing snapshots remain available.",
              )}
            </p>
          ) : null}
          {!loading && !snapshots?.snapshots.length ? (
            <p>{t("No workspace snapshots available.")}</p>
          ) : null}
          {snapshots?.snapshots.map((snapshot) => (
            <button
              key={snapshot.id}
              type="button"
              disabled={locked || !snapshots.available}
              onClick={() => setSelectedSnapshot(snapshot)}
            >
              {snapshot.label || snapshot.id} ·{" "}
              {new Date(snapshot.timestamp_unix * 1000).toLocaleString()}
            </button>
          ))}
        </div>
      ) : mode === "rewind" ? (
        <div className={styles.rows}>
          {!loading && !checkpoints.length ? (
            <p>{t("No user turns to rewind.")}</p>
          ) : null}
          {checkpoints.map((checkpoint) => (
            <button
              key={checkpoint.key}
              type="button"
              disabled={locked}
              onClick={() => setSelectedCheckpoint(checkpoint)}
            >
              #{checkpoint.checkpoint} ·{" "}
              {checkpoint.preview || t("(attachment prompt)")}
            </button>
          ))}
        </div>
      ) : (
        <section>
          <label>
            {t("New conversation name")}
            <input
              aria-label={t("New conversation name")}
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              disabled={locked}
            />
          </label>
          <p>
            {t(
              "Up to 50 UTF-8 bytes. No #, :, /, control characters, or the reserved name “default”.",
            )}
          </p>
          <button
            type="button"
            disabled={locked || !validForkChatId(branchName)}
            onClick={() => void apply()}
          >
            {t("Create conversation fork")}
          </button>
        </section>
      )}
      {selectedSnapshot || selectedCheckpoint ? (
        <section
          className={styles.confirm}
          aria-label={t("Confirm history change")}
        >
          <p>
            {selectedSnapshot
              ? t("Restore “{value0}” in this workspace?", {
                  value0: String(selectedSnapshot.label || selectedSnapshot.id),
                })
              : t("Rewind to checkpoint #{value0}?", {
                  value0: String(selectedCheckpoint!.checkpoint),
                })}
          </p>
          {selectedCheckpoint?.mediaCount ? (
            <p>
              {t(
                "The prompt contained attachments; reattach them before resending.",
              )}
            </p>
          ) : null}
          {selectedCheckpoint && selectedCheckpoint.userMessageCount > 1 ? (
            <p>
              {t("This turn contains") + " "}
              {selectedCheckpoint.userMessageCount}
              {" " +
                t(
                  "user messages. They belong to one thread and will be removed together.",
                )}
            </p>
          ) : null}
          <button type="button" disabled={locked} onClick={() => void apply()}>
            {t("Confirm")}{" "}
            {mode === "undo"
              ? t("workspace restore")
              : t("conversation rewind")}
          </button>
          <button
            type="button"
            disabled={mutating}
            onClick={() => {
              setSelectedSnapshot(null);
              setSelectedCheckpoint(null);
            }}
          >
            {t("Cancel")}
          </button>
        </section>
      ) : null}
      {notice ? <p role="status">{notice}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {state.forkedSessionId ? (
        <p className={styles.scope}>
          {t("Fork:") + " "}
          {state.forkedSessionId}
        </p>
      ) : null}
      {state.prefill !== null && !state.prefillApplied ? (
        <label>
          {t("Rewound prompt (your existing draft was preserved)")}
          <textarea readOnly value={state.prefill} rows={5} />
        </label>
      ) : null}
      {state.canRetryRefresh ? (
        <button
          type="button"
          disabled={mutating || !binding.isCurrent()}
          onClick={() => void coordinator.retryRefresh()}
        >
          {t("Retry Session refresh")}
        </button>
      ) : !state.completed && !state.uncertain ? (
        <button
          type="button"
          disabled={loading || mutating || !binding.isCurrent()}
          onClick={() => void coordinator.load()}
        >
          {t("Reload history")}
        </button>
      ) : null}
    </ModalSurface>
  );
}
