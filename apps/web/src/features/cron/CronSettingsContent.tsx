import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  CRON_CREATE,
  CRON_DELETE,
  type CronCreateParams,
  type CronJob,
  type CronListResult,
} from "@octos-org/octoscode-client/cron";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";

interface CronSettingsContentProps {
  client: OctosUiClient;
  capabilities: UiProtocolCapabilities;
  sessionId: string;
}

type ScheduleKind = "At" | "Every" | "Cron";
interface CreateForm {
  kind: ScheduleKind;
  at: string;
  everyMinutes: string;
  cronExpression: string;
  timezone: string;
  message: string;
  mode: "agent" | "notify";
}
const INITIAL_FORM: CreateForm = {
  kind: "At",
  at: "",
  everyMinutes: "30",
  cronExpression: "",
  timezone: "",
  message: "",
  mode: "agent",
};

export function CronSettingsContent({
  client,
  capabilities,
  sessionId,
}: CronSettingsContentProps) {
  const t = useUiText();
  const canToggle = supportsMethod(capabilities, CORE_UI_METHODS.CRON_TOGGLE);
  const canCreate = supportsMethod(capabilities, CRON_CREATE);
  const canDelete = supportsMethod(capabilities, CRON_DELETE);
  const [state, setState] = useState<CronListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateForm>(INITIAL_FORM);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const mutationBusy = creating || busyJob !== null;
  const writesBlocked = mutationBusy || state?.gatewayRunning === true;

  useEffect(() => {
    mutationGeneration.current += 1;
    setState(null);
    setBusyJob(null);
    setCreating(false);
    setDeleteJobId(null);
    setForm(INITIAL_FORM);
  }, [client, capabilities, sessionId]);

  useEffect(() => {
    let current = true;
    const generation = ++listGeneration.current;
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    void client
      .cronCommands(capabilities)
      .then((commands) => commands.list())
      .then(
        (result) => {
          if (current && generation === listGeneration.current) {
            setState(result);
            setLoading(false);
          }
        },
        (reason: unknown) => {
          if (current && generation === listGeneration.current) {
            setError(errorMessage(reason));
            setErrorDetail(errorDetails(reason));
            setLoading(false);
          }
        },
      );
    return () => {
      current = false;
      if (generation === listGeneration.current) listGeneration.current += 1;
    };
  }, [client, capabilities, refreshToken, sessionId]);

  const toggle = async (job: CronJob) => {
    if (writesBlocked || !canToggle) return;
    const generation = ++mutationGeneration.current;
    const listVersion = ++listGeneration.current;
    setLoading(false);
    setBusyJob(job.id);
    setError(null);
    try {
      const commands = await client.cronCommands(capabilities);
      const updated = await commands.toggle(job.id, !job.enabled);
      if (
        generation !== mutationGeneration.current ||
        listVersion !== listGeneration.current
      )
        return;
      setState((current) =>
        current
          ? {
              ...current,
              jobs: current.jobs.map((candidate) =>
                candidate.id === updated.id ? updated : candidate,
              ),
            }
          : current,
      );
    } catch (reason) {
      if (generation === mutationGeneration.current)
        setError(errorMessage(reason));
      setErrorDetail(errorDetails(reason));
    } finally {
      if (generation === mutationGeneration.current) setBusyJob(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (writesBlocked || !canCreate) return;
    const params = createParams(form, sessionId);
    if (typeof params === "string") {
      setError(t(params));
      setErrorDetail(null);
      return;
    }
    const generation = ++mutationGeneration.current;
    const listVersion = ++listGeneration.current;
    setLoading(false);
    setCreating(true);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.cronCommands(capabilities);
      const created = await commands.create(params);
      if (
        generation !== mutationGeneration.current ||
        listVersion !== listGeneration.current
      )
        return;
      setState((current) =>
        current
          ? {
              ...current,
              jobs: [created, ...current.jobs],
              count: current.count + 1,
            }
          : current,
      );
      setForm(INITIAL_FORM);
      if (created.enabled && created.nextRun === null) {
        setError(
          t(
            "The server returned an enabled task without a next run. It is not scheduled to run.",
          ),
        );
      }
      setRefreshToken((current) => current + 1);
    } catch (reason) {
      if (generation === mutationGeneration.current)
        setError(errorMessage(reason));
      setErrorDetail(errorDetails(reason));
    } finally {
      if (generation === mutationGeneration.current) setCreating(false);
    }
  };

  const deleteJob = async (job: CronJob) => {
    if (writesBlocked || !canDelete) return;
    const generation = ++mutationGeneration.current;
    const listVersion = ++listGeneration.current;
    setLoading(false);
    setBusyJob(job.id);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.cronCommands(capabilities);
      await commands.delete(sessionId, job.id);
      if (
        generation !== mutationGeneration.current ||
        listVersion !== listGeneration.current
      )
        return;
      setState((current) =>
        current
          ? {
              ...current,
              jobs: current.jobs.filter((candidate) => candidate.id !== job.id),
              count: Math.max(0, current.count - 1),
            }
          : current,
      );
      setDeleteJobId(null);
      setRefreshToken((current) => current + 1);
    } catch (reason) {
      if (generation === mutationGeneration.current)
        setError(errorMessage(reason));
      setErrorDetail(errorDetails(reason));
    } finally {
      if (generation === mutationGeneration.current) setBusyJob(null);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Scheduled tasks")}</h2>
          <p>
            {t(
              "Cron jobs for this server Profile; new jobs use the current Session.",
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefreshToken((current) => current + 1)}
        >
          {t("Refresh")}
        </button>
      </header>
      {canCreate ? (
        <details className={styles.create} key={sessionId}>
          <summary>{t("New scheduled task")}</summary>
          <form
            className={styles.form}
            onSubmit={(event) => void create(event)}
          >
            <div className={styles.fields}>
              <label>
                {t("Schedule type")}
                <select
                  value={form.kind}
                  disabled={writesBlocked}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      kind: event.target.value as ScheduleKind,
                    }))
                  }
                >
                  <option value="At">{t("At a specific time")}</option>
                  <option value="Every">{t("At an interval")}</option>
                  <option value="Cron">{t("Cron expression")}</option>
                </select>
              </label>
              {form.kind === "At" ? (
                <label>
                  {t("Run at")}
                  <input
                    type="datetime-local"
                    value={form.at}
                    disabled={writesBlocked}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        at: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : form.kind === "Every" ? (
                <label>
                  {t("Every (minutes)")}
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.everyMinutes}
                    disabled={writesBlocked}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        everyMinutes: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : (
                <>
                  <label>
                    {t("Cron expression")}
                    <input
                      type="text"
                      value={form.cronExpression}
                      disabled={writesBlocked}
                      placeholder="0 0 9 * * *"
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          cronExpression: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {t("Timezone (optional)")}
                    <input
                      type="text"
                      value={form.timezone}
                      disabled={writesBlocked}
                      placeholder={t("UTC")}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          timezone: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              )}
              <label>
                {t("Delivery")}
                <select
                  value={form.mode}
                  disabled={writesBlocked}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      mode: event.target.value as "agent" | "notify",
                    }))
                  }
                >
                  <option value="agent">{t("Agent (runs a turn)")}</option>
                  <option value="notify">{t("Notify (message only)")}</option>
                </select>
              </label>
            </div>
            <label>
              {t("Message")}
              <textarea
                rows={3}
                value={form.message}
                disabled={writesBlocked}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    message: event.target.value,
                  }))
                }
              />
            </label>
            <div className={styles.formActions}>
              <button type="submit" disabled={writesBlocked}>
                {creating ? t("Creating…") : t("Create scheduled task")}
              </button>
            </div>
          </form>
        </details>
      ) : (
        <p className={styles.notice}>
          {t("Creating scheduled tasks is not supported by this server.")}
        </p>
      )}
      {!canDelete ? (
        <p className={styles.meta}>
          {t("Deleting scheduled tasks is not supported by this server.")}
        </p>
      ) : null}
      {state?.gatewayRunning ? (
        <p className={styles.notice}>
          {t("The gateway owns cron writes. Stop it before changing a job.")}
        </p>
      ) : null}
      {!canToggle ? (
        <p className={styles.meta}>
          {t("This server exposes cron jobs read-only.")}
        </p>
      ) : null}
      {error ? (
        <div className={styles.error} role="alert">
          <p>{error}</p>
          {errorDetail ? (
            <details>
              <summary>{t("Technical details")}</summary>
              <code>{errorDetail}</code>
            </details>
          ) : null}
        </div>
      ) : null}
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {state ? (
        <>
          {!state.jobs.length ? <p>{t("No scheduled tasks yet.")}</p> : null}
          <div className={styles.rows}>
            {state.jobs.map((job) => (
              <article
                key={job.id}
                className={styles.row}
                data-cron-job={job.id}
              >
                <div className={styles.rowHeading}>
                  <strong>{job.name}</strong>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={job.enabled}
                      disabled={writesBlocked || !canToggle}
                      onChange={() => void toggle(job)}
                    />
                    {busyJob === job.id && deleteJobId !== job.id
                      ? t("Saving…")
                      : job.enabled
                        ? t("Enabled")
                        : t("Disabled")}
                  </label>
                </div>
                <p>{job.message}</p>
                <p className={styles.meta}>
                  {job.channel ?? t("No channel")} · {t("Next run:")}{" "}
                  {formatNextRun(job) ?? t("No next run")}
                </p>
                {job.enabled && job.nextRun === null ? (
                  <p className={styles.error} role="alert">
                    {t(
                      "This enabled task has no next run and is not scheduled. Check its schedule and server version.",
                    )}
                  </p>
                ) : null}
                <p className={styles.meta}>
                  {t("Last run:")} {job.lastRun ?? t("Never")}
                </p>
                {job.lastError ? (
                  <p className={styles.meta}>
                    {t("Last error:")} {job.lastError}
                  </p>
                ) : null}
                <details>
                  <summary>{t("Schedule and status")}</summary>
                  <code>{JSON.stringify(job.schedule)}</code>
                  {job.lastStatus ? (
                    <p className={styles.meta}>{job.lastStatus}</p>
                  ) : null}
                  {job.timezone ? (
                    <p className={styles.meta}>{job.timezone}</p>
                  ) : null}
                </details>
                {canDelete ? (
                  deleteJobId === job.id ? (
                    <div className={styles.deleteConfirm}>
                      <span>{t("Delete this scheduled task?")}</span>
                      <div>
                        <button
                          type="button"
                          disabled={writesBlocked}
                          onClick={() => setDeleteJobId(null)}
                        >
                          {t("Cancel")}
                        </button>
                        <button
                          type="button"
                          className={styles.dangerButton}
                          disabled={writesBlocked}
                          onClick={() => void deleteJob(job)}
                        >
                          {busyJob === job.id
                            ? t("Deleting…")
                            : t("Delete scheduled task")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={styles.deleteButton}
                      disabled={writesBlocked}
                      onClick={() => setDeleteJobId(job.id)}
                    >
                      {t("Delete")}
                    </button>
                  )
                ) : null}
              </article>
            ))}
          </div>
          {state.truncated ? (
            <p className={styles.meta}>{t("Only the first jobs are shown.")}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function createParams(
  form: CreateForm,
  sessionId: string,
): CronCreateParams | string {
  if (!form.message.trim()) return "Enter a message for this scheduled task.";
  const base = {
    session_id: sessionId,
    message: form.message.trim(),
    mode: form.mode,
    ...(form.kind === "Cron" && form.timezone.trim()
      ? { timezone: form.timezone.trim() }
      : {}),
  };
  if (form.kind === "At") {
    const atMs = new Date(form.at).getTime();
    if (!form.at || !Number.isSafeInteger(atMs)) {
      return "Choose a valid date and time.";
    }
    if (atMs <= Date.now()) return "Choose a future date and time.";
    return { ...base, schedule: { kind: "At", at_ms: atMs } };
  }
  if (form.kind === "Every") {
    const minutes = Number(form.everyMinutes);
    if (
      !Number.isSafeInteger(minutes) ||
      minutes < 1 ||
      minutes > Number.MAX_SAFE_INTEGER / 60_000
    ) {
      return "Enter a whole number of minutes greater than zero.";
    }
    return {
      ...base,
      schedule: { kind: "Every", every_ms: minutes * 60_000 },
    };
  }
  const expression = form.cronExpression.trim();
  if (!expression) return "Enter a cron expression.";
  const fields = expression.split(/\s+/).length;
  if (fields !== 6 && fields !== 7) {
    return "Use a cron expression with seconds (six or seven fields).";
  }
  return {
    ...base,
    schedule: { kind: "Cron", expr: expression },
  };
}

function errorDetails(reason: unknown): string | null {
  if (!reason || typeof reason !== "object" || !("data" in reason)) {
    return null;
  }
  const data = (reason as { data?: unknown }).data;
  if (data === undefined || data === null) return null;
  if (typeof data === "string") return data;
  if (typeof data === "object") {
    const detail = (data as Record<string, unknown>).detail;
    if (typeof detail === "string" && detail) return detail;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function formatNextRun(job: CronJob) {
  if (job.nextRun !== undefined && job.nextRun !== null) {
    const date = new Date(job.nextRun);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    }
  }
  return job.nextIn ?? null;
}
