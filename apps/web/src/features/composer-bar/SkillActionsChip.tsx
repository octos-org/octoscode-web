import { useEffect, useId, useRef, useState } from "react";
import {
  APPUI_SKILL_ACTION_METHODS,
  SKILL_ACTIONS_UI_FEATURE,
  SKILL_ACTION_JOBS_UI_FEATURE,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import {
  parseSkillActionJobUpdated,
  skillActionKey,
  type SkillAction,
  type SkillActionJob,
} from "@octos-org/octoscode-client/skill-actions";
import { errorMessage } from "../../shared/errors.ts";
import { useOutsideDismiss } from "../product-controls/SessionControlBar.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  actionArgumentFields,
  actionArguments,
  actionArgumentsComplete,
  mergeSkillJobs,
  skillJobsActive,
  skillJobStatus,
} from "../skills/action-fields.ts";
import controlStyles from "../product-controls/SessionControlBar.module.css";
import styles from "./ComposerBar.module.css";

type Commands = Awaited<ReturnType<OctosUiClient["skillActionCommands"]>>;

type ActionsLoad =
  | { status: "idle" | "loading" }
  | { status: "ready"; actions: SkillAction[] }
  | { status: "error" };

/**
 * The composer's door to a Profile skill's actions (T-0394). An action runs
 * on the server through skill/action/invoke — never as prompt text — and its
 * background job is tracked from the server's own job list, so a refresh or a
 * session switch shows the same job instead of starting another.
 */
export interface SkillActionsStateProps {
  client: OctosUiClient;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
}

/**
 * Shared state for both entries to skill actions (T-0394 desktop chip,
 * T-0422 phone "+" section): capability gates, the action list, background
 * jobs, and the single-flight invoke. `listening` gates every read, so an
 * idle composer pays no RPC for having the entry.
 */
export function useSkillActionsState({
  client,
  profileId,
  sessionId,
  capabilities,
  listening,
}: SkillActionsStateProps & { listening: boolean }) {
  const actionsAvailable =
    supportsFeature(capabilities, SKILL_ACTIONS_UI_FEATURE) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.LIST) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.INVOKE);
  const jobsAvailable =
    supportsFeature(capabilities, SKILL_ACTION_JOBS_UI_FEATURE) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.JOB_LIST);

  const commands = (): Promise<Commands> =>
    client.skillActionCommands(profileId, sessionId, capabilities);

  const [load, setLoad] = useState<ActionsLoad>({ status: "idle" });
  useEffect(() => {
    if (!listening || !actionsAvailable) return;
    let current = true;
    setLoad({ status: "loading" });
    commands().then(
      (next) =>
        // Jobs are read here too, not on mount: an idle session must not
        // pay an extra RPC just because the chip exists.
        Promise.all([
          next.list(),
          jobsAvailable ? next.listJobs() : Promise.resolve([]),
        ]).then(
          ([actions, listed]) => {
            if (!current) return;
            setLoad({ status: "ready", actions });
            if (listed.length)
              setJobs((existing) => mergeSkillJobs(existing, listed));
          },
          () => current && setLoad({ status: "error" }),
        ),
      () => current && setLoad({ status: "error" }),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    listening,
    actionsAvailable,
    jobsAvailable,
    client,
    profileId,
    sessionId,
    capabilities,
  ]);

  const [jobs, setJobs] = useState<SkillActionJob[]>([]);
  /** What this tab sent for each job it started, so Retry can repeat it. */
  const remembered = useRef(new Map<string, Record<string, unknown>>());
  useEffect(() => {
    remembered.current.clear();
    setJobs([]);
  }, [client, profileId, sessionId]);

  useEffect(() => {
    if (!jobsAvailable) return;
    return client.subscribeNotifications((notification) => {
      const job = parseSkillActionJobUpdated(
        notification,
        profileId,
        sessionId,
      );
      if (job) setJobs((current) => mergeSkillJobs(current, [job]));
    });
  }, [client, profileId, sessionId, jobsAvailable]);

  useEffect(() => {
    if (!jobsAvailable || !skillJobsActive(jobs)) return;
    let current = true;
    const timer = window.setTimeout(() => {
      void commands().then(
        (next) =>
          next.listJobs().then(
            (latest) => {
              if (current)
                setJobs((existing) => mergeSkillJobs(existing, latest));
            },
            () => {
              // The next live update or reopening the menu reads again.
            },
          ),
        () => undefined,
      );
    }, 1_500);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, profileId, sessionId, jobsAvailable, jobs]);

  const [running, setRunning] = useState<SkillAction | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [syncOutput, setSyncOutput] = useState<string[] | null>(null);

  async function invoke(action: SkillAction, args: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRunError(null);
    setSyncOutput(null);
    try {
      const result = await (
        await commands()
      ).invoke(`${action.skillId}/${action.id}`, args);
      for (const job of result.jobs) remembered.current.set(job.id, args);
      if (result.jobs.length) {
        setJobs((current) => mergeSkillJobs(current, result.jobs));
        setRunning(null);
      } else {
        setSyncOutput(result.results.map((entry) => entry.output));
      }
    } catch (reason) {
      setRunError(errorMessage(reason).slice(0, 512));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return {
    actionsAvailable,
    jobsAvailable,
    load,
    jobs,
    running,
    values,
    busy,
    runError,
    syncOutput,
    invoke,
    remembered,
    setRunning,
    setValues,
    dismissRun: () => {
      setRunning(null);
      setRunError(null);
      setSyncOutput(null);
    },
    clearOutcome: () => {
      setRunError(null);
      setSyncOutput(null);
    },
  };
}

type SkillActionsState = ReturnType<typeof useSkillActionsState>;

/** The action list, run form, and jobs — shared by both entries (T-0422). */
export function SkillActionsContent({ state }: { state: SkillActionsState }) {
  const t = useUiText();
  const {
    load,
    jobs,
    running,
    values,
    busy,
    runError,
    syncOutput,
    invoke,
    remembered,
    setRunning,
    setValues,
    clearOutcome,
  } = state;
  return (
    <>
      <p className={controlStyles.status}>
        {t(
          "Runs the action on the server, not as a prompt. Its job and result are listed below.",
        )}
      </p>
      {load.status === "loading" ? (
        <p className={controlStyles.status}>{t("Loading actions…")}</p>
      ) : null}
      {load.status === "error" ? (
        <p className={controlStyles.status} role="alert">
          {t("Couldn't load this Profile's skill actions.")}
        </p>
      ) : null}
      {load.status === "ready" && load.actions.length === 0 ? (
        <p className={controlStyles.status}>{t("No actions are available.")}</p>
      ) : null}
      {load.status === "ready"
        ? load.actions.map((action) => {
            const key = skillActionKey(action);
            const fields = actionArgumentFields(action.inputSchema);
            const expanded =
              running?.skillId === action.skillId && running.id === action.id;
            const complete = actionArgumentsComplete(fields, values);
            return (
              <div key={key} data-skill-action={key}>
                <button
                  type="button"
                  role="menuitem"
                  className={controlStyles.option}
                  disabled={!action.available || busy}
                  title={
                    action.available
                      ? undefined
                      : (action.unavailableReason ?? undefined)
                  }
                  onClick={() => {
                    clearOutcome();
                    setValues({});
                    setRunning(expanded ? null : action);
                  }}
                >
                  <span className={controlStyles.optionCopy}>
                    <span className={controlStyles.optionName}>
                      {action.label}
                    </span>
                    <span className={controlStyles.optionDescription}>
                      {[
                        action.skillId,
                        action.description ??
                          t("Description not reported by the server."),
                      ].join(" · ")}
                    </span>
                  </span>
                </button>
                {expanded ? (
                  <div className={styles.actionRun}>
                    {fields.map((field) =>
                      field.type === "boolean" ? (
                        <label key={field.name} className={styles.field}>
                          <input
                            type="checkbox"
                            checked={values[field.name] === true}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.name]: event.target.checked,
                              }))
                            }
                          />
                          {field.name}
                        </label>
                      ) : (
                        <label key={field.name} className={styles.field}>
                          {field.name}
                          <input
                            value={String(values[field.name] ?? "")}
                            onChange={(event) =>
                              setValues((current) => ({
                                ...current,
                                [field.name]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ),
                    )}
                    <button
                      type="button"
                      disabled={busy || !complete}
                      onClick={() =>
                        void invoke(action, actionArguments(fields, values))
                      }
                    >
                      {busy ? t("Running…") : t("Run")}
                    </button>
                    {syncOutput?.map((output, index) => (
                      <pre key={index} className={styles.actionOutput}>
                        {output}
                      </pre>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}
      {runError ? (
        <p className={controlStyles.status} role="alert">
          {runError}
        </p>
      ) : null}
      {jobs.length ? (
        <section aria-label={t("Action jobs")} className={styles.actionJobs}>
          <p className={controlStyles.status}>{t("Action jobs")}</p>
          {jobs.map((job) => {
            const retryArgs = remembered.current.get(job.id);
            return (
              <div key={job.id} data-skill-job={job.id}>
                <p className={controlStyles.status}>
                  {job.actionId} ·{" "}
                  <span data-job-status={job.status}>
                    {skillJobStatus(job.status, t)}
                  </span>
                </p>
                {job.error ? (
                  <p className={controlStyles.status} role="alert">
                    {job.error}
                  </p>
                ) : null}
                {job.output ? (
                  <details>
                    <summary>{t("Result details")}</summary>
                    <pre className={styles.actionOutput}>{job.output}</pre>
                  </details>
                ) : null}
                {job.status === "failed" && retryArgs ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const action = (
                        load.status === "ready" ? load.actions : []
                      ).find(
                        (candidate) =>
                          candidate.skillId === job.skillId &&
                          candidate.id === job.actionId,
                      );
                      if (action) void invoke(action, retryArgs);
                    }}
                  >
                    {t("Retry")}
                  </button>
                ) : null}
              </div>
            );
          })}
        </section>
      ) : null}
    </>
  );
}

/**
 * The composer's door to a Profile skill's actions (T-0394): a chip whose
 * popover carries SkillActionsContent. Phones get the same content inline in
 * the "+" menu instead (ComposerAddMenu, T-0422).
 */
export function SkillActionsChip(props: SkillActionsStateProps) {
  const t = useUiText();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const state = useSkillActionsState({ ...props, listening: open });
  const close = (restoreFocus = false) => {
    setOpen(false);
    state.dismissRun();
    if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
  };
  useOutsideDismiss(open, rootRef, () => close());
  const menuId = useId();

  if (!state.actionsAvailable) return null;
  const active = state.jobs.filter(
    (job) => job.status === "queued" || job.status === "running",
  ).length;
  return (
    <div ref={rootRef} className={controlStyles.control} data-skill-actions>
      <button
        ref={triggerRef}
        type="button"
        className={controlStyles.trigger}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={controlStyles.triggerLabel}>
          {active > 0
            ? t("Actions · {count} running", { count: active })
            : t("Actions")}
        </span>
      </button>
      {open ? (
        <div
          id={menuId}
          className={controlStyles.menu}
          role="dialog"
          aria-label={t("Skill actions")}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }}
        >
          <SkillActionsContent state={state} />
        </div>
      ) : null}
    </div>
  );
}
