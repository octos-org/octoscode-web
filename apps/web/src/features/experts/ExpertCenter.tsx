import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
} from "react";
import {
  peerIdentityForTopic,
  type PeerGatherResult,
  type PeerPrepareParams,
  type PeerPrepareResult,
} from "@octos-org/octoscode-client/peers";
import { randomUUID } from "../../shared/uuid.ts";
import type { GatherOutcome } from "../peers/gather.ts";
import {
  EMPTY_PEER_SNAPSHOT,
  type PeerManagerSnapshot,
  type PeerRosterEntry,
} from "../peers/peer-roster.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  ACTIVE_MEMBER_STATES,
  EXPERT_GOAL_MAX_CHARS,
  EXPERT_TEAMS,
  composeExpertTeam,
  expertSummaryInstruction,
  expertTeams,
  newTeamTag,
  type ExpertMemberState,
  type ExpertMemberView,
  type ExpertTeamTemplate,
  type ExpertTeamView,
} from "./expert-teams.ts";
import styles from "./ExpertCenter.module.css";

export interface ExpertTeamManager {
  subscribe(listener: () => void): () => void;
  getSnapshot(): PeerManagerSnapshot;
  kickoff(
    params: PeerPrepareParams,
    options?: { memberBriefs?: readonly string[] },
  ): Promise<PeerPrepareResult | null>;
  gather(): Promise<PeerGatherResult | null>;
}

export interface ExpertCenterProps {
  manager: ExpertTeamManager | null;
  /** Live rows for the members this tab opened. */
  roster: readonly PeerRosterEntry[];
  /** The server path of the current workspace; teams are kept per workspace. */
  workspace: string;
  workspaceLabel: string;
  /** The profile this conversation runs in; members are staged there. */
  profileId: string;
  canLaunch: boolean;
  canStop: boolean;
  canSummarize: boolean;
  onSummarize(instruction: string, slugs: string[]): Promise<GatherOutcome>;
  onOpenMember(member: {
    sessionId: string;
    cwd: string;
    profileId: string;
  }): void;
  onStopMember(entry: PeerRosterEntry): void;
}

const STATE_WORD: Readonly<Record<ExpertMemberState, string>> = {
  starting: "Starting",
  "not-started": "Did not start",
  working: "Working",
  waiting: "Waiting for you",
  finished: "Done",
  stopped: "Stopped",
  failed: "Failed",
  "rate-limited": "Hit a rate limit",
  closed: "Closed",
  "no-result": "No result yet",
};

const STATE_TONE: Readonly<Record<ExpertMemberState, string>> = {
  starting: "active",
  "not-started": "error",
  working: "active",
  waiting: "attention",
  finished: "success",
  stopped: "muted",
  failed: "error",
  "rate-limited": "error",
  closed: "muted",
  "no-result": "muted",
};

const STOPPABLE: ReadonlySet<ExpertMemberState> = new Set([
  "starting",
  "working",
  "waiting",
]);
/** Members keep running server-side; this only decides how often to look. */
const REFRESH_MS = 15_000;
const subscribeNothing = () => () => undefined;
const emptySnapshot = () => EMPTY_PEER_SNAPSHOT;

type LaunchError =
  | { kind: "goal" }
  | { kind: "refused"; detail: string | null }
  | { kind: "uncertain" };
type SummaryState = GatherOutcome | "busy";

export function ExpertCenter({
  manager,
  roster,
  workspace,
  workspaceLabel,
  profileId,
  canLaunch,
  canStop,
  canSummarize,
  onSummarize,
  onOpenMember,
  onStopMember,
}: ExpertCenterProps) {
  const t = useUiText();
  const id = useId();
  const snapshot = useSyncExternalStore(
    manager?.subscribe ?? subscribeNothing,
    manager?.getSnapshot ?? emptySnapshot,
    manager?.getSnapshot ?? emptySnapshot,
  );
  const teams = useMemo(
    () => expertTeams(snapshot.blackboard, roster, workspace),
    [snapshot.blackboard, roster, workspace],
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<LaunchError | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<
    Readonly<Record<string, SummaryState>>
  >({});
  const [readOnce, setReadOnce] = useState(false);
  const goalRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(() => {
    if (!manager) return;
    void manager
      .gather()
      .catch(() => null)
      .finally(() => setReadOnce(true));
  }, [manager]);

  // Read on arrival, and again whenever a member this tab watches changes state.
  const rosterKey = roster
    .map(
      (entry) =>
        `${entry.slug}:${entry.status}:${entry.activity}:${entry.outcome ?? ""}`,
    )
    .join("|");
  useEffect(() => {
    refresh();
  }, [refresh, rosterKey]);

  const watching = teams.some((team) =>
    team.members.some(
      (member) =>
        ACTIVE_MEMBER_STATES.has(member.state) || member.state === "no-result",
    ),
  );
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [watching, refresh]);

  const choose = (template: ExpertTeamTemplate) => {
    setLaunchError(null);
    setStarted(null);
    setSelected((current) => (current === template.id ? null : template.id));
  };
  useEffect(() => {
    if (selected) goalRef.current?.focus();
  }, [selected]);

  const launch = async (event: FormEvent, template: ExpertTeamTemplate) => {
    event.preventDefault();
    if (!manager || !canLaunch || launching) return;
    const text = goal.trim();
    if (!text) {
      setLaunchError({ kind: "goal" });
      goalRef.current?.focus();
      return;
    }
    setLaunching(true);
    setLaunchError(null);
    setStarted(null);
    // A clash with an earlier team's member names is the server saying no
    // before staging anything, so one retry with a fresh tag is safe.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const team = composeExpertTeam(t, template, {
        goal: text,
        workspace,
        tag: newTeamTag(randomUUID),
        startedAt: new Date(),
      });
      const result = await manager
        .kickoff(
          {
            brief: team.brief,
            n: team.names.length,
            names: team.names,
            title: team.title,
          },
          { memberBriefs: team.memberBriefs },
        )
        .catch(() => null);
      if (result) {
        setGoal("");
        setSelected(null);
        setStarted(
          t("{team} started: {count} experts are working.", {
            team: t(template.name),
            count: team.names.length,
          }),
        );
        setLaunching(false);
        refresh();
        return;
      }
      const after = manager.getSnapshot();
      if (after.prepareUncertain) {
        setLaunchError({ kind: "uncertain" });
        break;
      }
      if (attempt === 0 && /already exists/iu.test(after.prepareRefusal ?? ""))
        continue;
      setLaunchError({
        kind: "refused",
        detail: after.prepareRefusal ?? null,
      });
      break;
    }
    setLaunching(false);
    refresh();
  };

  const summarize = async (team: ExpertTeamView) => {
    const { instruction, slugs } = expertSummaryInstruction(t, team, (state) =>
      t(STATE_WORD[state]),
    );
    setSummaries((current) => ({ ...current, [team.key]: "busy" }));
    const outcome = await onSummarize(instruction, slugs).catch(
      (): GatherOutcome => "failed",
    );
    setSummaries((current) => ({ ...current, [team.key]: outcome }));
  };

  const formatTime = (ms: number) =>
    new Intl.DateTimeFormat(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(ms);

  const openMember = (team: ExpertTeamView, member: ExpertMemberView) => {
    const entry = member.entry;
    if (entry) {
      onOpenMember({
        sessionId: entry.identity,
        cwd: entry.cwd,
        profileId: entry.profileId,
      });
      return;
    }
    try {
      onOpenMember({
        sessionId: peerIdentityForTopic(profileId, `peer-${member.slug}`),
        // Members are staged without a worktree, in the team's workspace.
        cwd: team.workspace,
        profileId,
      });
    } catch {
      // A profile id the protocol cannot address has no member session to open.
    }
  };

  const memberRow = (team: ExpertTeamView, member: ExpertMemberView) => {
    const stoppable =
      canStop &&
      STOPPABLE.has(member.state) &&
      member.entry?.status === "started";
    return (
      <li
        key={member.slug}
        className={styles.member}
        data-expert-member={member.slug}
      >
        <div className={styles.memberHeading}>
          <span className={styles.memberName}>{t(member.label)}</span>
          <span
            className={styles.state}
            data-tone={STATE_TONE[member.state]}
            data-expert-state={member.state}
          >
            {t(STATE_WORD[member.state])}
          </span>
        </div>
        {member.focus ? (
          <p className={styles.focus}>{t(member.focus)}</p>
        ) : null}
        {member.result ? (
          <p className={styles.excerpt}>{member.result}</p>
        ) : member.state === "finished" ? (
          <p className={styles.hint}>
            {t("The answer is still being saved. It shows up here shortly.")}
          </p>
        ) : null}
        {member.state === "waiting" ? (
          <p className={styles.hint}>
            {t(
              "It is waiting for your approval or answer. Open its conversation to respond.",
            )}
          </p>
        ) : member.state === "no-result" ? (
          <p className={styles.hint}>
            {t(
              "It may still be working, or it may have been stopped. Open its conversation to see.",
            )}
          </p>
        ) : null}
        {member.reason ? (
          <details className={styles.details}>
            <summary>{t("Technical details")}</summary>
            <code>{member.reason}</code>
          </details>
        ) : null}
        <div className={styles.actions}>
          <button type="button" onClick={() => openMember(team, member)}>
            {t("Open conversation")}
          </button>
          {stoppable ? (
            <button
              type="button"
              className={styles.danger}
              onClick={() => onStopMember(member.entry!)}
            >
              {t("Stop")}
            </button>
          ) : null}
        </div>
      </li>
    );
  };

  const teamRow = (team: ExpertTeamView) => {
    const count = (states: readonly ExpertMemberState[]) =>
      team.members.filter((member) => states.includes(member.state)).length;
    const done = count(["finished"]);
    const active = count(["starting", "working", "waiting"]);
    const failed = count(["failed", "not-started", "rate-limited"]);
    const stopped = count(["stopped"]);
    const progress = [
      t("{done} of {total} done", { done, total: team.members.length }),
      ...(active ? [t("{count} still working", { count: active })] : []),
      ...(failed ? [t("{count} did not finish", { count: failed })] : []),
      ...(stopped ? [t("{count} stopped", { count: stopped })] : []),
    ].join(" · ");
    const stoppable = canStop
      ? team.members.filter(
          (member) =>
            STOPPABLE.has(member.state) && member.entry?.status === "started",
        )
      : [];
    const summary = summaries[team.key];
    const pending = team.members.length - done;
    return (
      <li key={team.key} className={styles.team} data-expert-team={team.key}>
        <div className={styles.rowHeading}>
          <h4>{team.template ? t(team.template.name) : t("Expert team")}</h4>
          {team.startedAt !== null ? (
            <span className={styles.when}>{formatTime(team.startedAt)}</span>
          ) : null}
        </div>
        {team.goal ? <p className={styles.goal}>{team.goal}</p> : null}
        <p className={styles.progress}>{progress}</p>
        <ul className={styles.members}>
          {team.members.map((member) => memberRow(team, member))}
        </ul>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryAction}
            disabled={!canSummarize || done === 0 || summary === "busy"}
            onClick={() => void summarize(team)}
          >
            {summary === "busy"
              ? t("Gathering results…")
              : t("Merge results in this conversation")}
          </button>
          {stoppable.length > 1 ? (
            <button
              type="button"
              className={styles.danger}
              onClick={() => {
                for (const member of stoppable) onStopMember(member.entry!);
              }}
            >
              {t("Stop all")}
            </button>
          ) : null}
        </div>
        {done > 0 && pending > 0 && summary !== "queued" ? (
          <p className={styles.hint}>
            {t(
              "{count} experts have no result yet. Merging now leaves their part out.",
              {
                count: pending,
              },
            )}
          </p>
        ) : null}
        {!canSummarize ? (
          <p className={styles.hint}>
            {t(
              "This conversation cannot take new messages right now, so results cannot be merged here.",
            )}
          </p>
        ) : null}
        <p role="status" className={styles.summaryStatus}>
          {summary === "queued"
            ? t("Merging was sent to this conversation.")
            : summary === "empty"
              ? t("There are no results to merge yet.")
              : summary === "blocked"
                ? t(
                    "This conversation cannot take the merge request right now. Try again when it is free.",
                  )
                : summary === "stale" || summary === "failed"
                  ? t("The results could not be read. Try again.")
                  : ""}
        </p>
      </li>
    );
  };

  return (
    <div className={styles.scroll} data-expert-center>
      <div className={styles.page}>
        <header className={styles.heading}>
          <div>
            <h2>{t("Expert teams")}</h2>
            <p>
              {t(
                "Hand one task to several experts at once. Each works from one angle in its own conversation, and the results are merged in this conversation.",
              )}
            </p>
          </div>
        </header>

        <p role="status" className={styles.started}>
          {started ?? ""}
        </p>

        {teams.length ? (
          <section aria-labelledby={`${id}-teams`} className={styles.section}>
            <div className={styles.sectionHeading}>
              <h3 id={`${id}-teams`}>{t("Teams in this workspace")}</h3>
              <button
                type="button"
                disabled={snapshot.gatherBusy}
                onClick={refresh}
              >
                {snapshot.gatherBusy ? t("Refreshing…") : t("Refresh")}
              </button>
            </div>
            <ul className={styles.rows}>{teams.map(teamRow)}</ul>
          </section>
        ) : !readOnce ? (
          <p className={styles.hint}>{t("Loading expert teams…")}</p>
        ) : null}
        {snapshot.gatherError ? (
          <p className={styles.error} role="alert">
            {t("The state of the expert teams could not be read.")}{" "}
            <button
              type="button"
              className={styles.inlineButton}
              onClick={refresh}
            >
              {t("Try again")}
            </button>
          </p>
        ) : null}

        <section aria-labelledby={`${id}-templates`} className={styles.section}>
          <div className={styles.sectionHeading}>
            <h3 id={`${id}-templates`}>{t("Start a team")}</h3>
          </div>
          <ul className={styles.rows}>
            {EXPERT_TEAMS.map((template) => {
              const open = selected === template.id;
              const formId = `${id}-${template.id}`;
              return (
                <li
                  key={template.id}
                  className={styles.template}
                  data-expert-template={template.id}
                >
                  <div className={styles.rowHeading}>
                    <h4>{t(template.name)}</h4>
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={formId}
                      onClick={() => choose(template)}
                    >
                      {open ? t("Close") : t("Choose")}
                    </button>
                  </div>
                  <p className={styles.purpose}>{t(template.purpose)}</p>
                  <p className={styles.hint}>
                    {template.members
                      .map((member) => t(member.label))
                      .join(t(", "))}
                  </p>
                  {open ? (
                    <form
                      id={formId}
                      className={styles.form}
                      noValidate
                      onSubmit={(event) => void launch(event, template)}
                    >
                      <dl className={styles.roster}>
                        {template.members.map((member) => (
                          <div key={member.label}>
                            <dt>{t(member.label)}</dt>
                            <dd>{t(member.focus)}</dd>
                          </div>
                        ))}
                      </dl>
                      <label className={styles.field}>
                        <span>{t(template.goalLabel)}</span>
                        <textarea
                          ref={goalRef}
                          rows={4}
                          maxLength={EXPERT_GOAL_MAX_CHARS}
                          value={goal}
                          placeholder={t(template.goalPlaceholder)}
                          aria-invalid={launchError?.kind === "goal"}
                          disabled={launching}
                          onChange={(event) => setGoal(event.target.value)}
                        />
                      </label>
                      <p className={styles.notice}>
                        {t(
                          "{count} experts each run a full conversation of their own at the same time, and merging takes one more turn here. Expect roughly {times} times the usage of asking once.",
                          {
                            count: template.members.length,
                            times: template.members.length + 1,
                          },
                        )}
                      </p>
                      <p className={styles.hint}>
                        {t(
                          "They work in {workspace}. They are asked to only read and not change files.",
                          {
                            workspace: workspaceLabel,
                          },
                        )}
                      </p>
                      <div className={styles.submit}>
                        <button
                          type="submit"
                          disabled={!canLaunch || launching}
                        >
                          {launching
                            ? t("Starting…")
                            : t("Start {count} experts", {
                                count: template.members.length,
                              })}
                        </button>
                        {!canLaunch ? (
                          <p>
                            {t("This connection cannot start expert teams.")}
                          </p>
                        ) : null}
                      </div>
                      {launchError ? (
                        <div className={styles.error} role="alert">
                          {launchError.kind === "goal" ? (
                            <p>
                              {t("Describe what the experts should work on.")}
                            </p>
                          ) : launchError.kind === "uncertain" ? (
                            <p>
                              {t(
                                "It is not clear whether the team started. Refresh to see whether it is listed above; until then no new team can be started from this conversation.",
                              )}
                            </p>
                          ) : (
                            <>
                              <p>
                                {t(
                                  "The team was not started; nothing was created. You can try again.",
                                )}
                              </p>
                              {launchError.detail ? (
                                <details className={styles.details}>
                                  <summary>{t("Technical details")}</summary>
                                  <code>{launchError.detail}</code>
                                </details>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </form>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
