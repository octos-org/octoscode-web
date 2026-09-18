import { useState } from "react";
import type { AutonomyController } from "./use-autonomy.ts";
import { composeAgentSpawn, type AgentSpawnHost } from "./agent-spawn.ts";
import styles from "./AutonomyPanel.module.css";
import { useUiText } from "../preferences/ui-text.tsx";

const TERMINAL = new Set(["completed", "failed", "interrupted", "closed"]);

/** Native agent RPCs only; no task scheduler or fabricated agent lifecycle. */
export function AgentPanel({
  controller,
  onSpawnAgents,
  spawnAvailable = false,
}: { controller: AutonomyController } & AgentSpawnHost) {
  const t = useUiText();
  const { state, capabilities: caps } = controller;
  const [queryId, setQueryId] = useState("");
  const [artifactPath, setArtifactPath] = useState("");
  const [spawnCount, setSpawnCount] = useState("1");
  const [spawnPrompt, setSpawnPrompt] = useState("");
  const [spawnError, setSpawnError] = useState<string | null>(null);
  if (
    !caps.agentList &&
    !caps.agentStatusRead &&
    !caps.agentOutputRead &&
    !caps.agentArtifactList &&
    !caps.agentArtifactRead &&
    !caps.agentInterrupt &&
    !caps.agentClose
  )
    return null;
  const actions = (agentId: string, terminal = false) => {
    const pending = state.pendingAgentIds.has(agentId);
    const unavailable = agentId.trim() === "";
    return (
      <div className={styles.actions}>
        {caps.agentStatusRead ? (
          <button
            type="button"
            disabled={unavailable}
            aria-label={t("Read status of agent {value0}", {
              value0: String(agentId),
            })}
            onClick={() => void controller.readAgentStatus(agentId)}
          >
            {t("Read status")}
          </button>
        ) : null}
        {caps.agentOutputRead ? (
          <button
            type="button"
            disabled={unavailable}
            aria-label={t("Read output of agent {value0}", {
              value0: String(agentId),
            })}
            onClick={() => void controller.readAgentOutput(agentId)}
          >
            {t("Read output")}
          </button>
        ) : null}
        {caps.agentArtifactList ? (
          <button
            type="button"
            disabled={unavailable}
            aria-label={t("List artifacts of agent {value0}", {
              value0: String(agentId),
            })}
            onClick={() => void controller.listAgentArtifacts(agentId)}
          >
            {t("List artifacts")}
          </button>
        ) : null}
        {caps.agentInterrupt ? (
          <button
            type="button"
            disabled={unavailable || pending || terminal}
            aria-label={t("Interrupt agent {value0}", {
              value0: String(agentId),
            })}
            onClick={() => void controller.controlAgent(agentId, "interrupt")}
          >
            {t("Interrupt agent")}
          </button>
        ) : null}
        {caps.agentClose ? (
          <button
            type="button"
            className={styles.danger}
            disabled={unavailable || pending || terminal}
            aria-label={t("Close agent {value0}", { value0: String(agentId) })}
            onClick={() => void controller.controlAgent(agentId, "close")}
          >
            {t("Close agent")}
          </button>
        ) : null}
      </div>
    );
  };
  return (
    <section className={styles.group} aria-label={t("Agent roster")}>
      <h3>{t("Agents")}</h3>
      {caps.agentList && onSpawnAgents ? (
        <form
          className={styles.form}
          aria-label={t("Request parallel agents")}
          onSubmit={(event) => {
            event.preventDefault();
            if (!spawnAvailable) return;
            const text = composeAgentSpawn(Number(spawnCount), spawnPrompt);
            if (!text) {
              setSpawnError(
                "Choose a positive whole-number count and enter the task.",
              );
              return;
            }
            if (!onSpawnAgents(text)) {
              setSpawnError(
                "Agent request was not queued. The owning session must still be idle and ready.",
              );
              return;
            }
            setSpawnPrompt("");
            setSpawnError(null);
          }}
        >
          <label>
            {t("Agent count")}
            <input
              type="number"
              min={1}
              max={4_294_967_295}
              step={1}
              value={spawnCount}
              onChange={(event) => setSpawnCount(event.target.value)}
            />
          </label>
          <label>
            {t("Agent task")}
            <textarea
              value={spawnPrompt}
              onChange={(event) => setSpawnPrompt(event.target.value)}
            />
          </label>
          <button
            type="submit"
            disabled={
              !spawnAvailable ||
              !composeAgentSpawn(Number(spawnCount), spawnPrompt)
            }
          >
            {t("Request parallel agents")}
          </button>
          <p className={styles.empty}>
            {t(
              "Sends the native agent request through this session’s ordinary prompt queue. Available only while idle.",
            )}
          </p>
          {spawnError ? (
            <p role="alert" className={styles.error}>
              {spawnError}
            </p>
          ) : null}
        </form>
      ) : null}
      {caps.agentList ? (
        state.agents.length === 0 ? (
          <p className={styles.empty}>{t("No agents running.")}</p>
        ) : (
          <ul className={styles.list} aria-label={t("Agent list")}>
            {state.agents.map((agent) => (
              <li key={agent.agent_id} className={styles.card}>
                <span className={styles.title}>{agent.nickname}</span>
                <dl className={styles.meta}>
                  <div>
                    <dt>{t("Role")}</dt>
                    <dd>{agent.role}</dd>
                  </div>
                  <div>
                    <dt>{t("Status")}</dt>
                    <dd>{agent.status}</dd>
                  </div>
                  <div>
                    <dt>{t("Last task")}</dt>
                    <dd>{agent.last_task ?? agent.title ?? "—"}</dd>
                  </div>
                </dl>
                {agent.output_tail ? (
                  <pre className={styles.output}>{agent.output_tail}</pre>
                ) : null}
                {actions(agent.agent_id, TERMINAL.has(agent.status))}
              </li>
            ))}
          </ul>
        )
      ) : null}
      <details className={styles.card}>
        <summary>{t("Inspect or control an agent by ID")}</summary>
        <label>
          {t("Agent ID")}
          <input
            value={queryId}
            onChange={(event) => setQueryId(event.target.value)}
          />
        </label>
        {actions(queryId.trim())}
        {caps.agentArtifactRead ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (queryId.trim() && artifactPath.trim())
                void controller.readAgentArtifact(queryId.trim(), {
                  path: artifactPath.trim(),
                });
            }}
          >
            <label>
              {t("Artifact path")}
              <input
                value={artifactPath}
                onChange={(event) => setArtifactPath(event.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={!queryId.trim() || !artifactPath.trim()}
            >
              {t("Read artifact by path")}
            </button>
          </form>
        ) : null}
      </details>
      {state.agentDetailBusy ? (
        <p role="status">{t("Reading agent details…")}</p>
      ) : null}
      {state.agentStatus ? (
        <div className={styles.card} aria-label={t("Agent status detail")}>
          <span className={styles.title}>
            {t("Status —") + " "}
            {state.agentStatus.agent_id}
          </span>
          <dl className={styles.meta}>
            <div>
              <dt>{t("Status")}</dt>
              <dd>{state.agentStatus.status}</dd>
            </div>
            <div>
              <dt>{t("Owner session")}</dt>
              <dd>{state.agentStatus.session_id}</dd>
            </div>
            <div>
              <dt>{t("Profile")}</dt>
              <dd>{state.agentStatus.profile_id}</dd>
            </div>
            <div>
              <dt>{t("Backend")}</dt>
              <dd>{state.agentStatus.backend_kind}</dd>
            </div>
            <div>
              <dt>{t("Artifacts")}</dt>
              <dd>{state.agentStatus.artifact_count}</dd>
            </div>
          </dl>
          {state.agentStatus.summary ? (
            <p>{state.agentStatus.summary}</p>
          ) : null}
        </div>
      ) : null}
      {state.agentArtifacts ? (
        <div className={styles.card} aria-label={t("Agent artifacts")}>
          <span className={styles.title}>
            {t("Artifacts —") + " "}
            {state.agentArtifacts.agent_id}
          </span>
          {state.agentArtifacts.artifacts.length === 0 ? (
            <p>{t("No artifacts available.")}</p>
          ) : (
            <ul className={styles.list}>
              {state.agentArtifacts.artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <span>
                    {artifact.title} — {artifact.kind} · {artifact.status}
                  </span>
                  {caps.agentArtifactRead ? (
                    <button
                      type="button"
                      aria-label={t("Read artifact {value0}", {
                        value0: String(artifact.id),
                      })}
                      onClick={() => {
                        const owner = state.agentArtifacts;
                        if (owner)
                          void controller.readAgentArtifact(owner.agent_id, {
                            artifactId: artifact.id,
                          });
                      }}
                    >
                      {t("Read artifact")}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {state.agentArtifact ? (
        <div className={styles.card} aria-label={t("Agent artifact content")}>
          <span className={styles.title}>
            {t("Artifact —") + " "}
            {state.agentArtifact.agent_id} / {state.agentArtifact.artifact.id}
          </span>
          <p>{state.agentArtifact.artifact.title}</p>
          {state.agentArtifact.content === null ? (
            <p>{t("No readable content available.")}</p>
          ) : (
            <pre className={styles.output}>{state.agentArtifact.content}</pre>
          )}
        </div>
      ) : null}
      {state.agentOutput ? (
        <div className={styles.card}>
          <span className={styles.title}>
            {t("Output —") + " "}
            {state.agentOutput.agent_id}
          </span>
          <pre className={styles.output}>{state.agentOutput.text}</pre>
          {state.agentOutput.has_more ? (
            <button
              type="button"
              aria-label={t("Load more agent output")}
              disabled={state.agentOutputBusy}
              onClick={() => {
                const output = state.agentOutput;
                if (output)
                  void controller.readAgentOutput(output.agent_id, true);
              }}
            >
              {t("Load more")}
            </button>
          ) : null}
        </div>
      ) : null}
      {state.agentsError ? (
        <p className={styles.error} role="alert">
          {state.agentsError}
        </p>
      ) : null}
    </section>
  );
}
