import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import type { InspectionBinding } from "./inspection-binding.ts";
import {
  createInspectionController,
  type InspectionResult,
} from "./inspection-controller.ts";
import type { InspectionRequest } from "./intent.ts";
import styles from "./InspectionDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface InspectionDialogProps {
  binding: InspectionBinding;
  request: InspectionRequest;
  onClose(): void;
}
export function InspectionDialog(props: InspectionDialogProps) {
  return <BoundInspectionDialog key={props.binding.authorityKey} {...props} />;
}
function BoundInspectionDialog({
  binding,
  request,
  onClose,
}: InspectionDialogProps) {
  const t = useUiText();
  const titleId = useId();
  const controller = useMemo(
    () => createInspectionController(binding),
    [binding],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const kind = request.kind;
  const turnId = request.kind === "turn" ? request.turnId : null;
  const visibleResult =
    binding.isCurrent() &&
    state.result?.kind === kind &&
    (state.result.kind !== "turn" || state.result.value.turn_id === turnId)
      ? state.result
      : null;
  useEffect(() => {
    void controller.load(
      kind === "turn" ? { kind, turnId: turnId! } : { kind },
    );
    return controller.cancel;
  }, [controller, kind, turnId]);
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      onEscape={onClose}
    >
      <header className={styles.header}>
        <h2 id={titleId}>
          {kind === "threads"
            ? t("Thread graph")
            : kind === "turn"
              ? t("Turn state")
              : t("Remembered approvals")}
        </h2>
        <button type="button" onClick={onClose}>
          {t("Close inspector")}
        </button>
      </header>
      <p className={styles.scope}>
        {t("Session:") + " "}
        {binding.scope.sessionId}
      </p>
      {turnId ? (
        <p className={styles.scope}>
          {t("Turn:") + " "}
          {turnId}
        </p>
      ) : null}
      <p>
        {t(
          "Read-only server snapshot. Reading does not change the conversation, queued prompts, or active Session.",
        )}
      </p>
      <button
        type="button"
        disabled={
          state.phase === "loading" ||
          state.phase === "retired" ||
          !binding.isCurrent()
        }
        onClick={() => void controller.load(request)}
      >
        {state.phase === "loading" ? t("Reading…") : t("Refresh inspection")}
      </button>
      {state.phase === "loading" ? (
        <p role="status">{t("Reading the captured Session…")}</p>
      ) : null}
      {state.error ? <p role="alert">{state.error}</p> : null}
      {visibleResult ? <InspectionContent result={visibleResult} /> : null}
    </ModalSurface>
  );
}
export function InspectionContent({ result }: { result: InspectionResult }) {
  const t = useUiText();
  if (result.kind === "approval-scopes") {
    return (
      <section aria-label={t("Remembered approval scopes")}>
        <p>
          {result.value.scopes.length}
          {" " + t("remembered approval scope(s) for this Session.")}
        </p>
        {!result.value.scopes.length ? (
          <p>{t("No remembered approval scopes for this Session.")}</p>
        ) : (
          <ul className={styles.rows}>
            {result.value.scopes.map((scope, index) => (
              <li key={index}>
                <strong>{scope.scope}</strong>
                <p>
                  {t("Match:") + " "}
                  {scope.scope_match || t("(empty)")}
                </p>
                <p>
                  {t("Decision:") + " "}
                  {scope.decision}
                </p>
                {scope.turn_id ? (
                  <p>
                    {t("Turn:") + " "}
                    {scope.turn_id}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p>
          {t(
            "This view lists server-owned decisions only. It does not clear or change permissions.",
          )}
        </p>
      </section>
    );
  }
  if (result.kind === "threads") {
    const graph = result.value;
    return (
      <section aria-label={t("Native thread graph")}>
        <p>
          {graph.threads.length}
          {" " + t("thread(s) · Cursor") + " "}
          {graph.cursor.stream}:{graph.cursor.seq}
        </p>
        {!graph.threads.length ? (
          <p>{t("No threads returned for this Session.")}</p>
        ) : (
          <ul className={styles.rows}>
            {graph.threads.map((thread) => (
              <li key={thread.thread_id}>
                <strong>{thread.thread_id}</strong>
                <p>
                  {t("Status:") + " "}
                  {thread.status}
                  {" " + t("· Root sequence:") + " "}
                  {thread.root_seq} · {thread.message_seqs.length}
                  {" " + t("message(s)")}
                </p>
                {thread.turn_id ? (
                  <p>
                    {t("Turn:") + " "}
                    {thread.turn_id}
                  </p>
                ) : null}
                {thread.root_client_message_id ? (
                  <p>
                    {t("Root client message:") + " "}
                    {thread.root_client_message_id}
                  </p>
                ) : null}
                <p>
                  {t("Message sequences:") + " "}
                  {thread.message_seqs.join(", ") || t("None")}
                </p>
              </li>
            ))}
          </ul>
        )}
        {graph.orphans.length ? (
          <p>
            {t("Orphan message sequences:") + " "}
            {graph.orphans.join(", ")}
          </p>
        ) : null}
      </section>
    );
  }
  const turn = result.value;
  const context = turn.context_state ?? turn.context?.state;
  return (
    <section aria-label={t("Native turn state")}>
      <dl className={styles.facts}>
        <dt>{t("State")}</dt>
        <dd>{turn.state}</dd>
        {turn.thread_id ? (
          <>
            <dt>{t("Thread")}</dt>
            <dd>{turn.thread_id}</dd>
          </>
        ) : null}
        {turn.started_at ? (
          <>
            <dt>{t("Started")}</dt>
            <dd>{turn.started_at}</dd>
          </>
        ) : null}
        {turn.completed_at ? (
          <>
            <dt>{t("Completed")}</dt>
            <dd>{turn.completed_at}</dd>
          </>
        ) : null}
        <dt>{t("Committed message sequences")}</dt>
        <dd>{turn.committed_seqs.join(", ") || t("None")}</dd>
      </dl>
      {turn.state === "unknown" ? (
        <p>
          {t(
            "The Session is known, but the server has no lifecycle record for this turn.",
          )}
        </p>
      ) : null}
      {context ? (
        <p>
          {t("Current Session context: generation") + " "}
          {context.generation} · {context.item_count}
          {" " + t("items ·") + " "}
          {context.token_estimate}
          {" " + t("estimated tokens ·") + " "}
          {context.recovery_state}
        </p>
      ) : null}
      {turn.context ? (
        <details>
          <summary>{t("Context lifecycle details")}</summary>
          <pre className={styles.context}>
            {JSON.stringify(turn.context, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
