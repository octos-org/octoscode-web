import { useState, type FormEvent } from "react";
import {
  parseArgvJsonInput,
  parseBudgetInput,
  describeGoalStatus,
  formatGoalBudget,
  formatInterval,
  formatTimestamp,
  loopIsControllable,
  monitorIsControllable,
} from "./model.ts";
import type { AutonomyController } from "./use-autonomy.ts";
import { AgentPanel } from "./AgentPanel.tsx";
import { LoopCreationControls } from "./LoopCreationControls.tsx";
import type { AgentSpawnHost } from "./agent-spawn.ts";
import styles from "./AutonomyPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

interface AutonomyPanelProps extends AgentSpawnHost {
  controller: AutonomyController;
  onClose?: () => void;
}

/**
 * Autonomy surface for the selected session: session goal, recurring loops,
 * zero-token monitors, and agent inspection. Every control is gated on the
 * server-advertised capability for its method; unadvertised methods render
 * nothing. The component consumes only the injected controller — never a
 * global bridge.
 */
export function AutonomyPanel({
  controller,
  onClose,
  onSpawnAgents,
  spawnAvailable,
}: AutonomyPanelProps) {
  const t = useUiText();
  const { state, capabilities } = controller;
  const [objective, setObjective] = useState("");
  const [tokenBudget, setTokenBudget] = useState("");
  const [monitorName, setMonitorName] = useState("");
  const [monitorArgv, setMonitorArgv] = useState("");
  const [monitorFilter, setMonitorFilter] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [argvError, setArgvError] = useState<string | null>(null);

  const goalControlsVisible = capabilities.goalSet || capabilities.goalClear;
  const loopControlsVisible = capabilities.loopCreate || capabilities.loopList;
  const monitorControlsVisible =
    capabilities.monitorCreate || capabilities.monitorList;

  const submitGoal = (event: FormEvent) => {
    event.preventDefault();
    const budget = parseBudgetInput(tokenBudget);
    if (budget.kind === "invalid") {
      setBudgetError(
        "Token budget must be a positive whole number (e.g. 500000).",
      );
      return;
    }
    setBudgetError(null);
    void controller.setGoal(
      objective,
      budget.kind === "set" ? budget.value : undefined,
    );
    setObjective("");
    setTokenBudget("");
  };

  const submitMonitor = (event: FormEvent) => {
    event.preventDefault();
    const argv = parseArgvJsonInput(monitorArgv);
    if (!argv) {
      setArgvError(
        'Probe command must be a JSON array of arguments, e.g. ["./scripts/watch.sh", "--verbose"].',
      );
      return;
    }
    setArgvError(null);
    void controller.createMonitor({
      name: monitorName,
      argv,
      ...(monitorFilter === "" ? {} : { filterRegex: monitorFilter }),
      mode: "poll",
    });
    setMonitorName("");
    setMonitorArgv("");
    setMonitorFilter("");
  };

  return (
    <section className={styles.panel} aria-label={t("Session autonomy")}>
      {onClose ? (
        <button
          type="button"
          className={styles.close}
          aria-label={t("Close autonomy panel")}
          onClick={onClose}
        >
          ×
        </button>
      ) : null}
      <header className={styles.header}>
        <span className={styles.eyebrow}>{t("Autonomy")}</span>
        <h2>{t("Session goal, loops & monitors")}</h2>
        {state.activity ? (
          <p className={styles.activity} role="status">
            {state.activity}
          </p>
        ) : null}
      </header>

      {goalControlsVisible || capabilities.goalGet ? (
        <section className={styles.group} aria-label={t("Session goal")}>
          <h3>{t("Goal")}</h3>
          {state.goal ? (
            <div className={styles.card} aria-busy={state.goalBusy}>
              <p className={styles.objective}>{state.goal.objective}</p>
              <dl className={styles.meta}>
                <div>
                  <dt>{t("Status")}</dt>
                  <dd>{describeGoalStatus(state.goal.status)}</dd>
                </div>
                <div>
                  <dt>{t("Budget")}</dt>
                  <dd>{formatGoalBudget(state.goal) ?? t("server default")}</dd>
                </div>
              </dl>
              {capabilities.goalGet &&
              capabilities.goalSet &&
              ["active", "paused", "budget_limited", "blocked"].includes(
                state.goal.status,
              ) ? (
                <div className={styles.actions}>
                  <button
                    type="button"
                    disabled={state.goalBusy}
                    aria-label={t("Pause session goal")}
                    onClick={() => void controller.transitionGoal("pause")}
                  >
                    {t("Pause goal")}
                  </button>
                  <button
                    type="button"
                    disabled={state.goalBusy}
                    aria-label={t("Resume session goal")}
                    onClick={() => void controller.transitionGoal("resume")}
                  >
                    {t("Resume goal")}
                  </button>
                  <button
                    type="button"
                    className={styles.danger}
                    disabled={state.goalBusy}
                    aria-label={t("Stop session goal")}
                    onClick={() => void controller.transitionGoal("stop")}
                  >
                    {t("Stop goal")}
                  </button>
                </div>
              ) : null}
              {state.goal.token_budget > 0 &&
              state.goal.tokens_used >= state.goal.token_budget ? (
                <p className={styles.empty}>
                  {t(
                    "This goal is over budget. Resuming does not increase its token budget.",
                  )}
                </p>
              ) : null}
              {capabilities.goalClear ? (
                <button
                  type="button"
                  className={styles.danger}
                  aria-label={t("Clear session goal")}
                  disabled={state.goalBusy}
                  onClick={() => void controller.clearGoal()}
                >
                  {t("Clear goal")}
                </button>
              ) : null}
            </div>
          ) : (
            <p className={styles.empty}>
              {t("No active goal for this session.")}
            </p>
          )}
          {capabilities.goalSet ? (
            <form className={styles.form} onSubmit={submitGoal}>
              <label>
                {t("Objective")}
                <textarea
                  value={objective}
                  onChange={(event) => setObjective(event.target.value)}
                  aria-label={t("Goal objective")}
                  placeholder={t(
                    "What should this session keep driving toward?",
                  )}
                  required
                />
              </label>
              <label>
                {t("Token budget (optional)")}
                <input
                  type="number"
                  min={1}
                  value={tokenBudget}
                  onChange={(event) => setTokenBudget(event.target.value)}
                  aria-label={t("Goal token budget, optional")}
                  placeholder={t("leave empty for the server default")}
                />
              </label>
              {budgetError ? (
                <p className={styles.error} role="alert">
                  {budgetError}
                </p>
              ) : null}
              <button
                type="submit"
                aria-label={t("Set session goal")}
                disabled={state.goalBusy || objective.trim() === ""}
              >
                {t("Set goal")}
              </button>
            </form>
          ) : null}
          {state.goalError ? (
            <p className={styles.error} role="alert">
              {state.goalError}
            </p>
          ) : null}
        </section>
      ) : null}

      {loopControlsVisible ? (
        <section className={styles.group} aria-label={t("Recurring loops")}>
          <h3>{t("Loops")}</h3>
          {state.loops.length === 0 ? (
            <p className={styles.empty}>{t("No loops in this session.")}</p>
          ) : (
            <ul className={styles.list} aria-label={t("Loop list")}>
              {state.loops.map((loop) => (
                <li key={loop.loop_id} className={styles.card}>
                  <span className={styles.title}>{loop.prompt}</span>
                  <dl className={styles.meta}>
                    <div>
                      <dt>{t("Mode")}</dt>
                      <dd>{formatInterval(loop.interval_seconds)}</dd>
                    </div>
                    <div>
                      <dt>{t("Status")}</dt>
                      <dd>{loop.status}</dd>
                    </div>
                    <div>
                      <dt>{t("Next run")}</dt>
                      <dd>{formatTimestamp(loop.next_run_at_ms) ?? "—"}</dd>
                    </div>
                  </dl>
                  <div className={styles.actions}>
                    {capabilities.loopFireNow ? (
                      <button
                        type="button"
                        aria-label={t("Fire loop {value0} now", {
                          value0: String(loop.loop_id),
                        })}
                        disabled={state.pendingLoopIds.has(loop.loop_id)}
                        onClick={() =>
                          void controller.controlLoop(loop.loop_id, "fire_now")
                        }
                      >
                        {t("Fire now")}
                      </button>
                    ) : null}
                    {capabilities.loopPause && loop.status === "active" ? (
                      <button
                        type="button"
                        aria-label={t("Pause loop {value0}", {
                          value0: String(loop.loop_id),
                        })}
                        disabled={state.pendingLoopIds.has(loop.loop_id)}
                        onClick={() =>
                          void controller.controlLoop(loop.loop_id, "pause")
                        }
                      >
                        {t("Pause")}
                      </button>
                    ) : null}
                    {capabilities.loopResume && loop.status === "paused" ? (
                      <button
                        type="button"
                        aria-label={t("Resume loop {value0}", {
                          value0: String(loop.loop_id),
                        })}
                        disabled={state.pendingLoopIds.has(loop.loop_id)}
                        onClick={() =>
                          void controller.controlLoop(loop.loop_id, "resume")
                        }
                      >
                        {t("Resume")}
                      </button>
                    ) : null}
                    {capabilities.loopDelete && loopIsControllable(loop) ? (
                      <button
                        type="button"
                        className={styles.danger}
                        aria-label={t("Delete loop {value0}", {
                          value0: String(loop.loop_id),
                        })}
                        disabled={state.pendingLoopIds.has(loop.loop_id)}
                        onClick={() =>
                          void controller.controlLoop(loop.loop_id, "delete")
                        }
                      >
                        {t("Delete")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <LoopCreationControls
            enabled={capabilities.loopCreate}
            busy={state.loopsBusy}
            createLoop={controller.createLoop}
          />
          {state.loopsError ? (
            <p className={styles.error} role="alert">
              {state.loopsError}
            </p>
          ) : null}
        </section>
      ) : null}

      {monitorControlsVisible ? (
        <section className={styles.group} aria-label={t("Zero-token monitors")}>
          <h3>{t("Monitors")}</h3>
          {state.monitors.length === 0 ? (
            <p className={styles.empty}>{t("No monitors in this session.")}</p>
          ) : (
            <ul className={styles.list} aria-label={t("Monitor list")}>
              {state.monitors.map((monitor) => (
                <li key={monitor.monitor_id} className={styles.card}>
                  <span className={styles.title}>{monitor.name}</span>
                  <code className={styles.argv}>{monitor.argv.join(" ")}</code>
                  <dl className={styles.meta}>
                    <div>
                      <dt>{t("Mode")}</dt>
                      <dd>{monitor.mode}</dd>
                    </div>
                    <div>
                      <dt>{t("Status")}</dt>
                      <dd>
                        {monitor.status}
                        {monitor.pause_reason
                          ? ` (${monitor.pause_reason})`
                          : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("Fires")}</dt>
                      <dd>{monitor.fires_used}</dd>
                    </div>
                  </dl>
                  <div className={styles.actions}>
                    {capabilities.monitorPause &&
                    monitor.status === "active" ? (
                      <button
                        type="button"
                        aria-label={t("Pause monitor {value0}", {
                          value0: String(monitor.monitor_id),
                        })}
                        disabled={state.pendingMonitorIds.has(
                          monitor.monitor_id,
                        )}
                        onClick={() =>
                          void controller.controlMonitor(
                            monitor.monitor_id,
                            "pause",
                          )
                        }
                      >
                        {t("Pause")}
                      </button>
                    ) : null}
                    {capabilities.monitorResume &&
                    monitor.status === "paused" ? (
                      <button
                        type="button"
                        aria-label={t("Resume monitor {value0}", {
                          value0: String(monitor.monitor_id),
                        })}
                        disabled={state.pendingMonitorIds.has(
                          monitor.monitor_id,
                        )}
                        onClick={() =>
                          void controller.controlMonitor(
                            monitor.monitor_id,
                            "resume",
                          )
                        }
                      >
                        {t("Resume")}
                      </button>
                    ) : null}
                    {capabilities.monitorDelete &&
                    monitorIsControllable(monitor) ? (
                      <button
                        type="button"
                        className={styles.danger}
                        aria-label={t("Delete monitor {value0}", {
                          value0: String(monitor.monitor_id),
                        })}
                        disabled={state.pendingMonitorIds.has(
                          monitor.monitor_id,
                        )}
                        onClick={() =>
                          void controller.controlMonitor(
                            monitor.monitor_id,
                            "delete",
                          )
                        }
                      >
                        {t("Delete")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {capabilities.monitorCreate ? (
            <form className={styles.form} onSubmit={submitMonitor}>
              <label>
                {t("Name")}
                <input
                  type="text"
                  value={monitorName}
                  onChange={(event) => setMonitorName(event.target.value)}
                  aria-label={t("New monitor name")}
                  placeholder={t("watch-build")}
                  required
                />
              </label>
              <label>
                {t("Command")}
                <input
                  type="text"
                  value={monitorArgv}
                  onChange={(event) => setMonitorArgv(event.target.value)}
                  aria-label={t("New monitor probe command")}
                  placeholder='["./scripts/watch.sh", "--verbose"]'
                  required
                />
              </label>
              {argvError ? (
                <p className={styles.error} role="alert">
                  {argvError}
                </p>
              ) : null}
              <label>
                {t("Filter regex (optional)")}
                <input
                  type="text"
                  value={monitorFilter}
                  onChange={(event) => setMonitorFilter(event.target.value)}
                  aria-label={t("New monitor filter regex, optional")}
                  placeholder={t("ERROR.*")}
                />
              </label>
              <button
                type="submit"
                aria-label={t("Create monitor")}
                disabled={
                  state.monitorsBusy ||
                  monitorName.trim() === "" ||
                  monitorArgv.trim() === ""
                }
              >
                {t("Create monitor")}
              </button>
            </form>
          ) : null}
          {state.monitorsError ? (
            <p className={styles.error} role="alert">
              {state.monitorsError}
            </p>
          ) : null}
        </section>
      ) : null}

      <AgentPanel
        controller={controller}
        {...(onSpawnAgents ? { onSpawnAgents } : {})}
        {...(spawnAvailable === undefined ? {} : { spawnAvailable })}
      />
    </section>
  );
}
