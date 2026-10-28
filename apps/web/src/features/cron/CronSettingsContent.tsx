import { useEffect, useState } from "react";
import {
  CORE_UI_METHODS,
  supportsMethod,
  type OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import type { CronJob, CronListResult } from "@octos-org/octoscode-client/cron";
import { errorMessage } from "../../shared/errors.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";

interface CronSettingsContentProps {
  client: OctosUiClient;
  capabilities: UiProtocolCapabilities;
}

export function CronSettingsContent({
  client,
  capabilities,
}: CronSettingsContentProps) {
  const t = useUiText();
  const canToggle = supportsMethod(capabilities, CORE_UI_METHODS.CRON_TOGGLE);
  const [state, setState] = useState<CronListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyJob, setBusyJob] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void client
      .cronCommands(capabilities)
      .then(
        (commands) => commands.list(),
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
            setRefreshing(false);
          }
        },
      )
      .then(
        (result) => {
          if (current && result) {
            setState(result);
            setLoading(false);
            setRefreshing(false);
          }
        },
        (reason: unknown) => {
          if (current) {
            setError(errorMessage(reason));
            setLoading(false);
            setRefreshing(false);
          }
        },
      );
    return () => {
      current = false;
    };
  }, [client, capabilities, refreshing]);

  const toggle = async (job: CronJob) => {
    if (busyJob || state?.gatewayRunning) return;
    setBusyJob(job.id);
    setError(null);
    try {
      const commands = await client.cronCommands(capabilities);
      const updated = await commands.toggle(job.id, !job.enabled);
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
      setError(errorMessage(reason));
    } finally {
      setBusyJob(null);
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.heading}>
        <div>
          <h2>{t("Scheduled tasks")}</h2>
          <p>{t("Existing cron jobs for this server Profile.")}</p>
        </div>
        <button
          type="button"
          disabled={loading || refreshing}
          onClick={() => setRefreshing(true)}
        >
          {t("Refresh")}
        </button>
      </header>
      <p className={styles.notice}>
        {t(
          "New scheduled tasks are unavailable until cron/create lands (T-0014).",
        )}
      </p>
      {state?.gatewayRunning ? (
        <p className={styles.notice}>
          {t(
            "The gateway owns cron writes. Stop it before enabling or disabling a job.",
          )}
        </p>
      ) : null}
      {!canToggle ? (
        <p className={styles.meta}>
          {t("This server exposes cron jobs read-only.")}
        </p>
      ) : null}
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p role="status">{t("Waiting for the server…")}</p> : null}
      {state ? (
        <>
          {!state.jobs.length ? <p>{t("No scheduled tasks yet.")}</p> : null}
          <div className={styles.rows}>
            {state.jobs.map((job) => (
              <article key={job.id} className={styles.row}>
                <div className={styles.rowHeading}>
                  <strong>{job.name}</strong>
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={job.enabled}
                      disabled={
                        busyJob !== null || state.gatewayRunning || !canToggle
                      }
                      onChange={() => void toggle(job)}
                    />
                    {busyJob === job.id
                      ? t("Saving…")
                      : job.enabled
                        ? t("Enabled")
                        : t("Disabled")}
                  </label>
                </div>
                <p>{job.message}</p>
                <p className={styles.meta}>
                  {job.channel ?? t("No channel")} ·{" "}
                  {job.nextIn ?? t("No next run")}
                </p>
                <details>
                  <summary>{t("Schedule and status")}</summary>
                  <code>{JSON.stringify(job.schedule)}</code>
                  {job.lastRun ? (
                    <p className={styles.meta}>{job.lastRun}</p>
                  ) : null}
                  {job.lastStatus ? (
                    <p className={styles.meta}>{job.lastStatus}</p>
                  ) : null}
                  {job.timezone ? (
                    <p className={styles.meta}>{job.timezone}</p>
                  ) : null}
                </details>
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
