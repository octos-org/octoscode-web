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
import { CheckIcon, CloseIcon, CronIcon } from "../../ui/Icon.tsx";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import type { RunOutcome } from "./run-outcome.ts";
import {
  TASK_TEMPLATES,
  WEEKDAYS,
  describeSchedule,
  draftSchedule,
  formatDateTime,
  initialDraft,
  jobDetail,
  jobTitle,
  templateMessage,
  type IntervalUnit,
  type RepeatKind,
  type ScheduleDraft,
  type TaskTemplateId,
  type Weekday,
} from "./schedule-form.ts";
import {
  displayNow,
  serverTimeRange,
  type ServerTimeRange,
} from "./server-clock.ts";
import { useRunOutcomes } from "./use-run-outcomes.ts";
import styles from "./ScheduledTasksPage.module.css";

interface ScheduledTasksPageProps {
  client: OctosUiClient;
  capabilities: UiProtocolCapabilities;
  sessionId: string;
  /** The title of a Session this browser can open, if it can. */
  sessionTitle: (sessionId: string) => string | null;
  /** Resolves whether that run's Session opened. */
  onOpenRun: (sessionId: string, turnId: string | null) => Promise<boolean>;
}

/** The list has no change event, so an open page reads it again on this beat. */
const REFRESH_MS = 10_000;
const CREATED_NOTICE_MS = 6_000;

const REPEATS: readonly { value: RepeatKind; label: string }[] = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "interval", label: "At an interval" },
  { value: "once", label: "Once" },
];

export function ScheduledTasksPage({
  client,
  capabilities,
  sessionId,
  sessionTitle,
  onOpenRun,
}: ScheduledTasksPageProps) {
  const t = useUiText();
  const canToggle = supportsMethod(capabilities, CORE_UI_METHODS.CRON_TOGGLE);
  const canCreate = supportsMethod(capabilities, CRON_CREATE);
  const canDelete = supportsMethod(capabilities, CRON_DELETE);
  const [state, setState] = useState<CronListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // The server's clock as the last list gave it away; run times are the
  // server's, so they are never compared with this browser's clock.
  const [serverRange, setServerRange] = useState<ServerTimeRange | null>(null);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState<boolean | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft>(() => initialDraft());
  const [template, setTemplate] = useState<TaskTemplateId>("custom");
  const [message, setMessage] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [openFailedJob, setOpenFailedJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const listGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const listReading = useRef(false);
  const listFailed = useRef(false);
  const mutationBusy = creating || busyJob !== null;
  const mutationBusyRef = useRef(mutationBusy);
  mutationBusyRef.current = mutationBusy;
  const writesBlocked = mutationBusy || state?.gatewayRunning === true;
  const { outcomes, reasons } = useRunOutcomes(
    client,
    state?.jobs ?? null,
    serverRange,
    now,
  );
  const shownNow = displayNow(serverRange, now, performance.now());

  useEffect(() => {
    mutationGeneration.current += 1;
    setState(null);
    setBusyJob(null);
    setCreating(false);
    setDeleteJobId(null);
    setFormOpen(null);
    setDraft(initialDraft());
    setTemplate("custom");
    setMessage("");
    setCreated(null);
  }, [client, capabilities, sessionId]);

  useEffect(() => {
    let current = true;
    const generation = ++listGeneration.current;
    listFailed.current = false;
    setLoading(true);
    setError(null);
    setErrorDetail(null);
    void client
      .cronCommands(capabilities)
      .then((commands) => commands.list(sessionId))
      .then(
        (result) => {
          if (current && generation === listGeneration.current) {
            setState(result);
            setServerRange(serverTimeRange(result.jobs, performance.now()));
            setLoading(false);
          }
        },
        (reason: unknown) => {
          if (current && generation === listGeneration.current) {
            listFailed.current = true;
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

  // A quiet read: it never takes the place of a load or a mutation's result,
  // and a miss waits for the next beat instead of raising an error. It does
  // clear the error of a load it has now recovered from.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (
        document.visibilityState !== "visible" ||
        listReading.current ||
        mutationBusyRef.current
      ) {
        return;
      }
      const generation = listGeneration.current;
      listReading.current = true;
      void client
        .cronCommands(capabilities)
        .then((commands) => commands.list(sessionId))
        .then((result) => {
          if (generation !== listGeneration.current) return;
          setState(result);
          setServerRange(serverTimeRange(result.jobs, performance.now()));
          if (listFailed.current) {
            listFailed.current = false;
            setError(null);
            setErrorDetail(null);
          }
        })
        .catch(() => undefined)
        .finally(() => {
          listReading.current = false;
        });
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [client, capabilities, sessionId]);

  useEffect(() => {
    if (!created) return;
    const timer = window.setTimeout(() => setCreated(null), CREATED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [created]);

  const toggle = async (job: CronJob) => {
    if (writesBlocked || !canToggle) return;
    const generation = ++mutationGeneration.current;
    const listVersion = ++listGeneration.current;
    setLoading(false);
    setBusyJob(job.id);
    setError(null);
    try {
      const commands = await client.cronCommands(capabilities);
      const updated = await commands.toggle(job.id, !job.enabled, sessionId);
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
      if (generation === mutationGeneration.current) {
        setError(errorMessage(reason));
        setErrorDetail(errorDetails(reason));
      }
    } finally {
      if (generation === mutationGeneration.current) setBusyJob(null);
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (writesBlocked || !canCreate) return;
    const params = createParams(draft, message, sessionId);
    if (typeof params === "string") {
      listFailed.current = false;
      setError(t(params));
      setErrorDetail(null);
      return;
    }
    const generation = ++mutationGeneration.current;
    ++listGeneration.current;
    setLoading(false);
    setCreating(true);
    setCreated(null);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.cronCommands(capabilities);
      const job = await commands.create(params);
      if (generation !== mutationGeneration.current) return;
      setState((current) => {
        if (!current) return current;
        const exists = current.jobs.some((entry) => entry.id === job.id);
        return {
          ...current,
          jobs: [job, ...current.jobs.filter((entry) => entry.id !== job.id)],
          count: current.count + (exists ? 0 : 1),
        };
      });
      setDraft(initialDraft());
      setTemplate("custom");
      setMessage("");
      setFormOpen(false);
      setCreated(jobTitle(job));
      setRefreshToken((current) => current + 1);
    } catch (reason) {
      if (generation === mutationGeneration.current) {
        setError(errorMessage(reason));
        setErrorDetail(errorDetails(reason));
      }
    } finally {
      if (generation === mutationGeneration.current) setCreating(false);
    }
  };

  const deleteJob = async (job: CronJob) => {
    if (writesBlocked || !canDelete) return;
    const generation = ++mutationGeneration.current;
    ++listGeneration.current;
    setLoading(false);
    setBusyJob(job.id);
    setCreated(null);
    setError(null);
    setErrorDetail(null);
    try {
      const commands = await client.cronCommands(capabilities);
      await commands.delete(sessionId, job.id);
      if (generation !== mutationGeneration.current) return;
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
      if (generation === mutationGeneration.current) {
        setError(errorMessage(reason));
        setErrorDetail(errorDetails(reason));
      }
    } finally {
      if (generation === mutationGeneration.current) setBusyJob(null);
    }
  };

  const openRun = async (job: CronJob, turnId: string | null) => {
    if (!job.originSessionId) return;
    setOpenFailedJob(null);
    if (!(await onOpenRun(job.originSessionId, turnId))) {
      setOpenFailedJob(job.id);
    }
  };

  const patchDraft = (patch: Partial<ScheduleDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const customCron = draft.cron.trim() !== "";
  const planned = draftSchedule(draft, now);
  const here = sessionTitle(sessionId);

  return (
    <div className={styles.scroll} data-scheduled-tasks>
      <div className={styles.page}>
        <header className={styles.heading}>
          <div>
            <h2>{t("Scheduled tasks")}</h2>
            <p>
              {t(
                "Octos does these on schedule, even with this page closed, and posts each result to the conversation it was created in.",
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
          <details
            className={styles.create}
            open={formOpen ?? state?.jobs.length === 0}
            onToggle={(event) => {
              const open = event.currentTarget.open;
              // Reflecting the default back would pin it before the list loads.
              if (open !== (formOpen ?? state?.jobs.length === 0)) {
                setFormOpen(open);
              }
            }}
          >
            <summary>{t("New scheduled task")}</summary>
            <form
              className={styles.form}
              onSubmit={(event) => void create(event)}
            >
              <fieldset className={styles.group} disabled={writesBlocked}>
                <legend>{t("When")}</legend>
                <div className={styles.choices}>
                  {REPEATS.map((repeat) => (
                    <label key={repeat.value} className={styles.choice}>
                      <input
                        type="radio"
                        name="scheduled-repeat"
                        checked={draft.repeat === repeat.value}
                        disabled={customCron}
                        onChange={() => patchDraft({ repeat: repeat.value })}
                      />
                      <span>{t(repeat.label)}</span>
                    </label>
                  ))}
                </div>
                <RepeatFields
                  draft={draft}
                  disabled={customCron}
                  onChange={patchDraft}
                />
              </fieldset>
              <fieldset className={styles.group} disabled={writesBlocked}>
                <legend>{t("What")}</legend>
                <div className={styles.choices}>
                  {[
                    ...TASK_TEMPLATES,
                    { id: "custom", title: "Write my own" } as const,
                  ].map((choice) => (
                    <label key={choice.id} className={styles.choice}>
                      <input
                        type="radio"
                        name="scheduled-template"
                        checked={template === choice.id}
                        onChange={() => {
                          setTemplate(choice.id);
                          setMessage(templateMessage(choice.id, t));
                        }}
                      />
                      <span>{t(choice.title)}</span>
                    </label>
                  ))}
                </div>
                <label className={styles.field}>
                  {t("What should Octos do?")}
                  <textarea
                    rows={4}
                    value={message}
                    placeholder={t(
                      "Tidy the new files in this folder and list the highlights",
                    )}
                    onChange={(event) => setMessage(event.target.value)}
                  />
                </label>
                <p className={styles.hint}>
                  {t("The first line becomes the task's name.")}
                </p>
              </fieldset>
              <details className={styles.advanced}>
                <summary>{t("Advanced options")}</summary>
                <div className={styles.fields}>
                  <label className={styles.field}>
                    {t("Cron expression")}
                    <input
                      type="text"
                      value={draft.cron}
                      disabled={writesBlocked}
                      placeholder="0 30 8 * * *"
                      onChange={(event) =>
                        patchDraft({ cron: event.target.value })
                      }
                    />
                  </label>
                  <label className={styles.field}>
                    {t("Timezone")}
                    <input
                      type="text"
                      value={draft.timezone}
                      disabled={writesBlocked}
                      onChange={(event) =>
                        patchDraft({ timezone: event.target.value })
                      }
                    />
                  </label>
                </div>
                <p className={styles.hint}>
                  {t(
                    "An expression replaces the time chosen above. Six fields, starting with seconds.",
                  )}
                </p>
              </details>
              <div className={styles.submit}>
                <button type="submit" disabled={writesBlocked}>
                  {creating ? t("Creating…") : t("Create scheduled task")}
                </button>
                {typeof planned !== "string" ? (
                  <p>
                    {describeSchedule(planned.schedule, t, planned.timezone)}
                    {" · "}
                    {here
                      ? t("results go to “{title}”", { title: here })
                      : t("results go to this conversation")}
                  </p>
                ) : null}
              </div>
              {draft.repeat === "once" && !customCron ? (
                <p className={styles.hint}>
                  {t(
                    "A one-time task leaves this list after it runs; its result stays in the conversation.",
                  )}
                </p>
              ) : null}
            </form>
          </details>
        ) : (
          <p className={styles.notice}>
            {t("Creating scheduled tasks is not supported by this server.")}
          </p>
        )}
        {!canDelete ? (
          <p className={styles.hint}>
            {t("Deleting scheduled tasks is not supported by this server.")}
          </p>
        ) : null}
        {state?.gatewayRunning ? (
          <p className={styles.notice}>
            {t("The gateway owns cron writes. Stop it before changing a job.")}
          </p>
        ) : null}
        {!canToggle ? (
          <p className={styles.hint}>
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
        {created ? (
          <p className={styles.created} role="status">
            {t("“{title}” is scheduled.", { title: created })}
          </p>
        ) : null}
        {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
        {state ? (
          <>
            {!state.jobs.length ? (
              <p className={styles.empty}>{t("No scheduled tasks yet.")}</p>
            ) : null}
            <div className={styles.rows}>
              {state.jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  outcome={outcomes.get(job.id) ?? { kind: "never" }}
                  reasons={reasons}
                  now={shownNow}
                  sessionTitle={
                    job.originSessionId
                      ? sessionTitle(job.originSessionId)
                      : null
                  }
                  saving={busyJob === job.id && deleteJobId !== job.id}
                  deleting={busyJob === job.id && deleteJobId === job.id}
                  confirmingDelete={deleteJobId === job.id}
                  openFailed={openFailedJob === job.id}
                  writesBlocked={writesBlocked}
                  canToggle={canToggle}
                  canDelete={canDelete}
                  onToggle={() => void toggle(job)}
                  onAskDelete={() => setDeleteJobId(job.id)}
                  onCancelDelete={() => setDeleteJobId(null)}
                  onDelete={() => void deleteJob(job)}
                  onOpenRun={(turnId) => void openRun(job, turnId)}
                />
              ))}
            </div>
            {state.truncated ? (
              <p className={styles.hint}>
                {t("Only the first jobs are shown.")}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

function RepeatFields({
  draft,
  disabled,
  onChange,
}: {
  draft: ScheduleDraft;
  disabled: boolean;
  onChange: (patch: Partial<ScheduleDraft>) => void;
}) {
  const t = useUiText();
  if (draft.repeat === "once") {
    return (
      <div className={styles.inline}>
        <label className={styles.field}>
          {t("Run at")}
          <input
            type="datetime-local"
            value={draft.at}
            disabled={disabled}
            onChange={(event) => onChange({ at: event.target.value })}
          />
        </label>
      </div>
    );
  }
  if (draft.repeat === "interval") {
    return (
      <div className={styles.inline}>
        <label className={styles.field}>
          {t("Every")}
          <input
            type="text"
            inputMode="numeric"
            value={draft.every}
            disabled={disabled}
            onChange={(event) => onChange({ every: event.target.value })}
          />
        </label>
        <label className={styles.field}>
          {t("Unit")}
          <select
            value={draft.unit}
            disabled={disabled}
            onChange={(event) =>
              onChange({ unit: event.target.value as IntervalUnit })
            }
          >
            <option value="hours">{t("hours")}</option>
            <option value="minutes">{t("minutes")}</option>
          </select>
        </label>
      </div>
    );
  }
  return (
    <div className={styles.inline}>
      {draft.repeat === "weekly" ? (
        <label className={styles.field}>
          {t("Day")}
          <select
            value={draft.weekday}
            disabled={disabled}
            onChange={(event) =>
              onChange({ weekday: event.target.value as Weekday })
            }
          >
            {WEEKDAYS.map((day) => (
              <option key={day.value} value={day.value}>
                {t(day.label)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className={styles.field}>
        {t("Time")}
        <input
          type="time"
          value={draft.time}
          disabled={disabled}
          onChange={(event) => onChange({ time: event.target.value })}
        />
      </label>
    </div>
  );
}

function JobRow({
  job,
  outcome,
  reasons,
  now,
  sessionTitle,
  saving,
  deleting,
  confirmingDelete,
  openFailed,
  writesBlocked,
  canToggle,
  canDelete,
  onToggle,
  onAskDelete,
  onCancelDelete,
  onDelete,
  onOpenRun,
}: {
  job: CronJob;
  outcome: RunOutcome;
  reasons: ReadonlyMap<string, string | null>;
  /** The server's now as far as it is known; null shows dates instead. */
  now: number | null;
  sessionTitle: string | null;
  saving: boolean;
  deleting: boolean;
  confirmingDelete: boolean;
  openFailed: boolean;
  writesBlocked: boolean;
  canToggle: boolean;
  canDelete: boolean;
  onToggle: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
  onOpenRun: (turnId: string | null) => void;
}) {
  const t = useUiText();
  const detail = jobDetail(job);
  const reason =
    outcome.kind === "failed"
      ? (reasons.get(outcome.turnId) ?? null)
      : outcome.kind === "undelivered"
        ? outcome.reason
        : null;
  const turnId = "turnId" in outcome ? outcome.turnId : null;
  const showRun =
    Boolean(job.originSessionId) &&
    outcome.kind !== "never" &&
    outcome.kind !== "undelivered" &&
    outcome.kind !== "pending";
  return (
    <article
      className={styles.row}
      data-cron-job={job.id}
      data-outcome={outcome.kind}
    >
      <div className={styles.rowHeading}>
        <h3>{jobTitle(job)}</h3>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={job.enabled}
            disabled={writesBlocked || !canToggle}
            onChange={onToggle}
          />
          {saving ? t("Saving…") : job.enabled ? t("Enabled") : t("Disabled")}
        </label>
      </div>
      <p className={styles.schedule}>
        {describeSchedule(job.schedule, t, job.timezone)}
        {sessionTitle
          ? ` · ${t("results go to “{title}”", { title: sessionTitle })}`
          : ""}
      </p>
      {detail ? <p className={styles.detail}>{detail}</p> : null}
      <dl className={styles.facts}>
        <div>
          <dt>{t("Next")}</dt>
          <dd>{nextRunText(job, now, t)}</dd>
        </div>
        <div>
          <dt>{t("Last")}</dt>
          <dd className={styles.result} data-tone={toneOf(outcome)}>
            <OutcomeIcon outcome={outcome} />
            <span>{outcomeText(outcome, now, t)}</span>
          </dd>
        </div>
      </dl>
      {reason ? (
        <p className={styles.reason} title={reason}>
          {reason}
        </p>
      ) : null}
      {job.enabled && job.nextRun === null ? (
        <p className={styles.reason} role="alert">
          {t(
            "This enabled task has no next run and is not scheduled. Check its schedule and server version.",
          )}
        </p>
      ) : null}
      {openFailed ? (
        <p className={styles.reason} role="alert">
          {t(
            "That conversation can't be opened here. It may have been deleted, or the message you're writing needs sending or clearing first.",
          )}
        </p>
      ) : null}
      <div className={styles.actions}>
        {showRun ? (
          <button
            type="button"
            className={styles.primaryAction}
            onClick={() => onOpenRun(turnId)}
          >
            {outcome.kind === "running"
              ? t("View progress")
              : turnId
                ? t("View result")
                : t("Open conversation")}
          </button>
        ) : null}
        {canDelete && !confirmingDelete ? (
          <button type="button" disabled={writesBlocked} onClick={onAskDelete}>
            {t("Delete")}
          </button>
        ) : null}
        {canDelete && confirmingDelete ? (
          <>
            <span>{t("Delete this scheduled task?")}</span>
            <button
              type="button"
              disabled={writesBlocked}
              onClick={onCancelDelete}
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={writesBlocked}
              onClick={onDelete}
            >
              {deleting ? t("Deleting…") : t("Delete scheduled task")}
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function OutcomeIcon({ outcome }: { outcome: RunOutcome }) {
  switch (toneOf(outcome)) {
    case "success":
      return <CheckIcon size={14} />;
    case "error":
      return <CloseIcon size={14} />;
    case "active":
      return <CronIcon size={14} />;
    default:
      return null;
  }
}

function toneOf(outcome: RunOutcome): string {
  switch (outcome.kind) {
    case "succeeded":
      return "success";
    case "failed":
    case "undelivered":
      return "error";
    case "pending":
    case "running":
      return "active";
    default:
      return "neutral";
  }
}

function outcomeText(
  outcome: RunOutcome,
  now: number | null,
  t: UiText,
): string {
  const when = "at" in outcome && outcome.at ? agoText(outcome.at, now, t) : "";
  const withTime = (label: string) => (when ? `${label} · ${when}` : label);
  switch (outcome.kind) {
    case "never":
      return t("Has not run yet");
    case "pending":
    case "running":
      return withTime(t("Running"));
    case "succeeded":
      return withTime(t("Success"));
    case "failed":
      return withTime(t("Run failed"));
    case "interrupted":
      return withTime(t("Stopped before finishing"));
    case "unconfirmed":
      return withTime(t("Started; no record of how it went"));
    case "unlinked":
      return withTime(
        outcome.why === "no-turn"
          ? t("Ran; it started no reply here")
          : outcome.why === "late"
            ? t("Ran; a reply came too late to tell if it was this run")
            : t("Ran; can't tell which reply is this run's"),
      );
    case "undelivered":
      return withTime(
        outcome.stopped
          ? t("Could not start, so it was turned off")
          : t("Could not start; it will try again"),
      );
  }
}

function nextRunText(job: CronJob, now: number | null, t: UiText): string {
  if (!job.enabled) return t("Turned off");
  const next = job.nextRun;
  if (next === undefined || next === null) {
    return job.nextIn ?? t("Not scheduled");
  }
  if (now === null) return formatDateTime(next);
  const wait = next - now;
  if (wait <= 60_000) return t("Within a minute");
  if (wait < 3_600_000) {
    return t("In about {count} min", { count: Math.round(wait / 60_000) });
  }
  return formatDateTime(next);
}

function agoText(at: number, now: number | null, t: UiText): string {
  if (now === null) return formatDateTime(at);
  const elapsed = Math.max(0, now - at);
  if (elapsed < 60_000) return t("just now");
  if (elapsed < 3_600_000) {
    return t("{count} min ago", { count: Math.floor(elapsed / 60_000) });
  }
  if (elapsed < 86_400_000) {
    return t("{count} hr ago", { count: Math.floor(elapsed / 3_600_000) });
  }
  return formatDateTime(at);
}

function createParams(
  draft: ScheduleDraft,
  message: string,
  sessionId: string,
): CronCreateParams | string {
  if (!message.trim()) return "Write what this task should do.";
  const planned = draftSchedule(draft);
  if (typeof planned === "string") return planned;
  return {
    session_id: sessionId,
    message: message.trim(),
    mode: "agent",
    ...planned,
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
