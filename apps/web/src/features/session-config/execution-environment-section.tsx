import type { ExecutionEnvironmentResult } from "@octos-org/octoscode-client/protocol";
import styles from "./SessionConfig.module.css";
import type { ExecutionEnvironmentState } from "./use-execution-environment.ts";

const BACKEND_LABELS: Record<ExecutionEnvironmentResult["backend"], string> = {
  docker: "Docker",
  bwrap: "bubblewrap (bwrap)",
  landlock: "Landlock",
  macos: "macOS",
  appcontainer: "AppContainer",
  none: "No isolation",
  unavailable: "Unavailable",
  unknown: "Unknown",
};
const TOOL_LABELS = {
  node: "Node.js",
  npm: "npm",
  git: "Git",
  python: "Python",
} as const;

export function ExecutionEnvironmentSection({
  state,
  t,
}: {
  state: ExecutionEnvironmentState | null | undefined;
  t: (source: string, params?: Record<string, string | number>) => string;
}) {
  if (!state) return null;
  return (
    <div
      className={styles["execution-environment"]}
      data-execution-environment="true"
    >
      <h4>{t("Execution environment")}</h4>
      {state.status === "loading" ? (
        <p className={styles["environment-muted"]}>
          {t("Reading execution environment…")}
        </p>
      ) : state.status === "unavailable" ? (
        <p className={styles["environment-muted"]}>
          {t("Execution environment is not available")}
        </p>
      ) : state.result.probe_status === "unsupported" ? (
        <p
          className={styles["environment-muted"]}
          data-probe-status="unsupported"
        >
          {t("This environment does not support probing")}
        </p>
      ) : (
        <ReadyEnvironment result={state.result} t={t} />
      )}
    </div>
  );
}

function ReadyEnvironment({
  result,
  t,
}: {
  result: ExecutionEnvironmentResult;
  t: (source: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <div data-probe-status={result.probe_status}>
      <div className={styles["session-config-row"]}>
        <span className={styles["session-config-row-label"]}>
          {t("Backend")}
        </span>
        <strong className={styles["session-config-row-value"]}>
          {t(BACKEND_LABELS[result.backend])}
        </strong>
      </div>
      {result.docker_image ? (
        <div className={styles["session-config-row"]}>
          <span className={styles["session-config-row-label"]}>
            {t("Docker image")}
          </span>
          <code className={styles["session-config-row-value"]}>
            {result.docker_image}
          </code>
        </div>
      ) : null}
      {(Object.keys(TOOL_LABELS) as Array<keyof typeof TOOL_LABELS>).map(
        (tool) => (
          <div className={styles["session-config-row"]} key={tool}>
            <span className={styles["session-config-row-label"]}>
              {TOOL_LABELS[tool]}
            </span>
            <span className={styles["session-config-row-value"]}>
              {t(toolStatusLabel(result.tools[tool]))}
            </span>
          </div>
        ),
      )}
      {result.probe_status === "failed" ? (
        <p className={styles["environment-muted"]} data-probe-error="true">
          {t("Probe failed: {value0}", {
            value0: result.probe_error ?? t("not reported"),
          })}
        </p>
      ) : null}
      <p className={styles["environment-muted"]}>
        {t("Probed:")}{" "}
        <time
          dateTime={result.probed_at}
          className={styles["environment-time"]}
        >
          {formatProbeTime(result.probed_at)}
        </time>
      </p>
    </div>
  );
}

function toolStatusLabel(status: "available" | "missing" | "unknown") {
  switch (status) {
    case "available":
      return "Available";
    case "missing":
      return "Missing";
    case "unknown":
      return "Unknown";
  }
}

function formatProbeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
