import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import type { SessionRecord } from "../session/session-record-manager.ts";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import type { ResumeBinding, ResumeCandidate } from "./resume-binding.ts";
import styles from "./ResumeDialog.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

export interface ResumeDialogProps {
  binding: ResumeBinding;
  /** Search filter only: never an automatic row selection or open request. */
  initialQuery?: string;
  onClose(): void;
  /** Synchronous host selection after the binding validates canonical history. */
  onResumed(record: SessionRecord<OctosUiClient>): void;
}
export function ResumeDialog(props: ResumeDialogProps) {
  return <BoundResumeDialog key={props.binding.authorityKey} {...props} />;
}
function BoundResumeDialog({
  binding,
  initialQuery = "",
  onClose,
  onResumed,
}: ResumeDialogProps) {
  const t = useUiText();
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<readonly ResumeCandidate[]>([]);
  const [selected, setSelected] = useState<ResumeCandidate | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState<"listing" | "opening" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const current = useSyncExternalStore(
    binding.subscribe,
    binding.isCurrent,
    binding.isCurrent,
  );
  const load = () => {
    if (request.current || !binding.isCurrent()) return;
    const abort = new AbortController();
    request.current = abort;
    setBusy("listing");
    setError(null);
    setSelected(null);
    setConfirmed(false);
    void binding
      .list(abort.signal)
      .then((result) => {
        if (!abort.signal.aborted && request.current === abort) setRows(result);
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted && request.current === abort)
          setError(
            reason instanceof Error
              ? reason.message
              : "History listing failed.",
          );
      })
      .finally(() => {
        if (request.current === abort) {
          request.current = null;
          setBusy(null);
        }
      });
  };
  useEffect(() => {
    load();
    return () => {
      request.current?.abort();
      request.current = null;
    };
  }, [binding]);
  useEffect(() => {
    setQuery(initialQuery);
    setSelected(null);
    setConfirmed(false);
  }, [initialQuery]);
  const close = () => {
    request.current?.abort();
    request.current = null;
    onClose();
  };
  const open = () => {
    if (!selected || !confirmed || request.current || !binding.isCurrent())
      return;
    const candidate = selected;
    const abort = new AbortController();
    request.current = abort;
    setBusy("opening");
    setError(null);
    setConfirmed(false);
    void binding
      .resume(
        candidate,
        {
          sessionId: candidate.id,
          workspaceRoot: binding.scope.workspaceRoot,
          profileId: binding.scope.profileId,
        },
        abort.signal,
      )
      .then((record) => {
        if (
          !abort.signal.aborted &&
          request.current === abort &&
          binding.isCurrent()
        )
          onResumed(record);
      })
      .catch((reason: unknown) => {
        if (!abort.signal.aborted && request.current === abort)
          setError(
            reason instanceof Error
              ? reason.message
              : "Historical identity was not resolved.",
          );
      })
      .finally(() => {
        if (request.current === abort) {
          request.current = null;
          setBusy(null);
        }
      });
  };
  const needle = query.trim().toLowerCase();
  const visible = current
    ? rows.filter((row) =>
        `${row.id}\n${row.title}\n${row.lastPrompt ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    : [];
  return (
    <ModalSurface
      backdropClassName={styles.backdrop!}
      dialogClassName={styles.dialog!}
      labelledBy={titleId}
      initialFocusRef={searchRef}
      onEscape={close}
    >
      <header className={styles.header}>
        <h2 id={titleId}>{t("Resume historical conversation")}</h2>
        <button type="button" onClick={close}>
          {t("Close history picker")}
        </button>
      </header>
      <p>
        {t(
          "Catalog rows are unverified candidates, not confirmed workspace sessions. The server may return a legacy global list even when a workspace is requested. Bare IDs cannot safely identify a historical conversation.",
        )}
      </p>
      <p className={styles.scope}>
        {t("Target Profile:") + " "}
        {binding.scope.profileId}
        <br />
        {t("Target workspace:") + " "}
        {binding.scope.workspaceRoot}
      </p>
      <label className={styles.field}>
        {t("Search history")}
        <input
          ref={searchRef}
          value={query}
          disabled={busy === "opening"}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setSelected(null);
            setConfirmed(false);
          }}
        />
      </label>
      <button type="button" disabled={Boolean(busy) || !current} onClick={load}>
        {t("Refresh historical candidates")}
      </button>
      {busy ? (
        <p role="status">
          {busy === "listing"
            ? t("Reading unverified history candidates…")
            : t("Opening and verifying the selected historical identity…")}
        </p>
      ) : null}
      {!current ? (
        <p role="alert">
          {t("Source Session changed. Close and reopen this picker.")}
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      <ul
        className={styles.rows}
        aria-label={t("Unverified historical candidates")}
      >
        {visible.map((row) => {
          const reason = binding.blockedReason(row);
          return (
            <li key={row.id}>
              <button
                type="button"
                disabled={Boolean(reason) || Boolean(busy) || !current}
                aria-pressed={selected === row}
                onClick={() => {
                  setSelected(row);
                  setConfirmed(false);
                  setError(null);
                }}
              >
                {row.title}
              </button>
              <p className={styles.scope}>
                {row.id} · {row.messageCount}
                {" " + t("listed message(s) · unverified")}
              </p>
              {row.lastPrompt ? <p>{row.lastPrompt}</p> : null}
              {reason ? <p>{reason}</p> : null}
            </li>
          );
        })}
      </ul>
      {!busy && !visible.length ? (
        <p>{t("No matching historical candidates.")}</p>
      ) : null}
      {selected && current ? (
        <section aria-label={t("Confirm history identity")}>
          <p className={styles.scope}>
            {t("Selected full identity:") + " "}
            {selected.id}
          </p>
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmed}
              disabled={Boolean(busy) || !current}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
            />
            {t("I confirm this Session should open in Profile")}{" "}
            {binding.scope.profileId}
            {" " + t("at") + " "}
            {binding.scope.workspaceRoot}.
          </label>
          <p>
            {t(
              "Opening does not submit a prompt. Canceling prevents later selection but cannot undo an already confirmed server opening.",
            )}
          </p>
          <button
            type="button"
            disabled={!confirmed || Boolean(busy) || !current}
            onClick={open}
          >
            {t("Verify history and resume")}
          </button>
        </section>
      ) : null}
    </ModalSurface>
  );
}
