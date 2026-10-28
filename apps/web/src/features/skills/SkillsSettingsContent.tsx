import { useEffect, useState } from "react";
import {
  APPUI_SKILL_ACTION_METHODS,
  SKILL_ACTIONS_UI_FEATURE,
  SKILL_ACTION_JOBS_UI_FEATURE,
  supportsFeature,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { InstalledSkill } from "@octos-org/octoscode-client/skills";
import {
  parseSkillActionJobUpdated,
  type SkillAction,
  type SkillActionInvocation,
  type SkillActionJob,
  type SkillActionJobStatus,
} from "@octos-org/octoscode-client/skill-actions";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import {
  actionArguments,
  actionArgumentsComplete,
  actionArgumentFields,
  mergeSkillJobs,
  skillJobsActive,
} from "./action-fields.ts";
import styles from "./SkillsSettings.module.css";

interface SkillsSettingsContentProps {
  client: OctosUiClient;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
}

export function SkillsSettingsContent({
  client,
  profileId,
  sessionId,
  capabilities,
}: SkillsSettingsContentProps) {
  const t = useUiText();
  const actionsAvailable =
    supportsFeature(capabilities, SKILL_ACTIONS_UI_FEATURE) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.LIST) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.INVOKE);
  const jobsAvailable =
    supportsFeature(capabilities, SKILL_ACTION_JOBS_UI_FEATURE) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.JOB_LIST) &&
    supportsMethod(capabilities, APPUI_SKILL_ACTION_METHODS.JOB_READ);
  const [installed, setInstalled] = useState<InstalledSkill[] | null>(null);
  const [actions, setActions] = useState<SkillAction[]>([]);
  const [jobs, setJobs] = useState<SkillActionJob[]>([]);
  const [invocation, setInvocation] = useState<SkillActionInvocation | null>(
    null,
  );
  const [argumentValues, setArgumentValues] = useState<
    Record<string, Record<string, string | boolean>>
  >({});
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    setInstalled(null);
    setActions([]);
    setJobs([]);
    setInvocation(null);
    void (async () => {
      try {
        const commands = await client.skillCommands(profileId, capabilities);
        const result = await commands.list();
        if (current) setInstalled(result);
      } catch (reason) {
        if (current) setError(errorMessage(reason));
      }
      if (actionsAvailable) {
        try {
          const commands = await client.skillActionCommands(
            profileId,
            sessionId,
            capabilities,
          );
          const [nextActions, nextJobs] = await Promise.all([
            commands.list(),
            jobsAvailable ? commands.listJobs() : Promise.resolve([]),
          ]);
          if (current) {
            setActions(nextActions);
            setJobs(nextJobs);
          }
        } catch (reason) {
          if (current) setError(errorMessage(reason));
        }
      }
      if (current) setLoading(false);
    })();
    return () => {
      current = false;
    };
  }, [
    client,
    profileId,
    sessionId,
    capabilities,
    actionsAvailable,
    jobsAvailable,
    refreshToken,
  ]);

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
      void client
        .skillActionCommands(profileId, sessionId, capabilities)
        .then((commands) => commands.listJobs())
        .then(
          (latest) => {
            if (current)
              setJobs((existing) => mergeSkillJobs(existing, latest));
          },
          () => {
            // The next live update or explicit Refresh remains available.
          },
        );
    }, 1_500);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [client, profileId, sessionId, capabilities, jobsAvailable, jobs]);

  const invoke = async (action: SkillAction) => {
    if (busyAction) return;
    const fields = actionArgumentFields(action.inputSchema);
    const values = argumentValues[action.id] ?? {};
    if (!action.available || !actionArgumentsComplete(fields, values)) return;
    setBusyAction(action.id);
    setError(null);
    try {
      const commands = await client.skillActionCommands(
        profileId,
        sessionId,
        capabilities,
      );
      const result = await commands.invoke(
        `${action.skillId}/${action.id}`,
        actionArguments(fields, values),
      );
      setInvocation(result);
      if (result.jobs.length) {
        setJobs((current) => mergeSkillJobs(current, result.jobs));
      }
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Skills")}</h2>
          <p>{t("Installed in server Profile {profileId}", { profileId })}</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => setRefreshToken((value) => value + 1)}
        >
          {t("Refresh skills")}
        </button>
      </header>
      <p className={styles.notice}>
        {t(
          "Remote one-click install is unavailable while supply-chain safeguards are being reviewed.",
        )}{" "}
        <a
          href="https://github.com/octos-org/octos/issues/2321"
          target="_blank"
          rel="noreferrer noopener"
        >
          #2321
        </a>
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <section aria-labelledby="installed-skills-heading">
        <h3 id="installed-skills-heading">{t("Installed skills")}</h3>
        {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
        {installed?.length === 0 ? (
          <p>{t("No skills installed in this Profile.")}</p>
        ) : null}
        <div className={styles.rows}>
          {installed?.map((skill) => (
            <article key={skill.name} className={styles.skill}>
              <div className={styles.skillHeading}>
                <strong>{skill.name}</strong>
                <span>{skill.version ?? t("Version not reported")}</span>
              </div>
              <p>{t("Description not reported by the server.")}</p>
              <p>
                {skill.sourceRepo ?? t("Source not reported")} ·{" "}
                {skill.toolCount} {t("tools")}
              </p>
            </article>
          ))}
        </div>
      </section>
      {actionsAvailable ? (
        <section aria-labelledby="skill-actions-heading">
          <h3 id="skill-actions-heading">{t("Actions")}</h3>
          {!actions.length && !loading ? (
            <p>{t("No actions are available.")}</p>
          ) : null}
          <div className={styles.rows}>
            {actions.map((action) => (
              <ActionCard
                key={`${action.skillId}/${action.id}`}
                action={action}
                values={argumentValues[action.id] ?? {}}
                busy={busyAction !== null}
                invoking={busyAction === action.id}
                onValue={(name, value) =>
                  setArgumentValues((current) => ({
                    ...current,
                    [action.id]: { ...current[action.id], [name]: value },
                  }))
                }
                onInvoke={() => void invoke(action)}
              />
            ))}
          </div>
        </section>
      ) : null}
      {invocation?.execution === "sync" ? (
        <section aria-labelledby="invocation-result-heading">
          <h3 id="invocation-result-heading">{t("Action result")}</h3>
          {invocation.results.map((result, index) => (
            <pre key={index} className={styles.output}>
              {result.output}
            </pre>
          ))}
        </section>
      ) : null}
      {jobsAvailable ? (
        <section aria-labelledby="skill-jobs-heading">
          <h3 id="skill-jobs-heading">{t("Action jobs")}</h3>
          {!jobs.length ? <p>{t("No action jobs yet.")}</p> : null}
          <div className={styles.rows}>
            {jobs.map((job) => (
              <article key={job.id} className={styles.job}>
                <div className={styles.skillHeading}>
                  <strong>{job.actionId}</strong>
                  <span data-job-status={job.status}>
                    {jobStatus(job.status, t)}
                  </span>
                </div>
                <small>{job.id}</small>
                {job.output ? (
                  <pre className={styles.output}>{job.output}</pre>
                ) : null}
                {job.error ? <p className={styles.error}>{job.error}</p> : null}
                {job.result !== undefined ? (
                  <details>
                    <summary>{t("Result details")}</summary>
                    <pre className={styles.output}>
                      {JSON.stringify(job.result, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function ActionCard({
  action,
  values,
  busy,
  invoking,
  onValue,
  onInvoke,
}: {
  action: SkillAction;
  values: Record<string, string | boolean>;
  busy: boolean;
  invoking: boolean;
  onValue: (name: string, value: string | boolean) => void;
  onInvoke: () => void;
}) {
  const t = useUiText();
  const fields = actionArgumentFields(action.inputSchema);
  const complete = actionArgumentsComplete(fields, values);
  return (
    <article className={styles.action}>
      <div className={styles.skillHeading}>
        <strong>{action.label}</strong>
        <span>
          {action.execution === "background" ? t("Background") : t("Immediate")}
        </span>
      </div>
      {action.description ? <p>{action.description}</p> : null}
      <small>
        {action.skillId}/{action.id}
      </small>
      {fields.map((field) => {
        const id = `skill-action-${action.id}-${field.name}`;
        const value = values[field.name];
        if (field.type === "boolean") {
          return (
            <label key={field.name} className={styles.checkbox} htmlFor={id}>
              <input
                id={id}
                type="checkbox"
                checked={value === true}
                disabled={busy}
                onChange={(event) => onValue(field.name, event.target.checked)}
              />
              {field.name}
            </label>
          );
        }
        return (
          <label key={field.name} htmlFor={id}>
            {field.name}
            <input
              id={id}
              name={field.name}
              autoComplete="off"
              type={field.type === "number" ? "number" : "text"}
              value={typeof value === "string" ? value : ""}
              disabled={busy}
              required
              onChange={(event) => onValue(field.name, event.target.value)}
            />
          </label>
        );
      })}
      {!action.available ? (
        <p>{action.unavailableReason ?? t("This action is unavailable.")}</p>
      ) : null}
      <button
        type="button"
        disabled={busy || !action.available || !complete}
        onClick={onInvoke}
      >
        {invoking ? t("Invoking…") : t("Invoke")}
      </button>
    </article>
  );
}

function jobStatus(status: SkillActionJobStatus, t: UiText): string {
  switch (status) {
    case "queued":
      return t("Queued");
    case "running":
      return t("Running");
    case "succeeded":
      return t("Succeeded");
    case "failed":
      return t("Failed");
    case "cancelled":
      return t("Cancelled");
    case "abandoned":
      return t("Abandoned");
  }
}
