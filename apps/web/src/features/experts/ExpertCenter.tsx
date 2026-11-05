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
import type { HydratedFileMutation } from "@octos-org/octoscode-client/protocol";
import { randomUUID } from "../../shared/uuid.ts";
import type { GatherOutcome } from "../peers/gather.ts";
import { MarkdownBody } from "../markdown/MarkdownBody.tsx";
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
  lastMemberTurn,
  membersToRead,
  newTeamTag,
  teamWrites,
  type ExpertMemberState,
  type MemberTurnRead,
  type ExpertMemberView,
  type ExpertTeamTemplate,
  type ExpertTeamView,
} from "./expert-teams.ts";
import {
  readMemberFiles,
  readMemberTurns,
  stopMemberTurn,
  type MemberSessionClient,
} from "./member-session.ts";
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
  /**
   * Reads and stops members this tab does not hold (after a refresh, or
   * started from another tab) through their own sessions. Null when the
   * server cannot hydrate a session; those members then show what the
   * blackboard says.
   */
  memberClient?: MemberSessionClient | null;
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
/** A member's files are read once its turn has ended, and again on Refresh. */
const FILES_SETTLED: ReadonlySet<ExpertMemberState> = new Set([
  "finished",
  "failed",
  "stopped",
  "rate-limited",
]);
/**
 * What a settled member's session recorded, by session, for this tab's
 * lifetime: reopening the page does not read every member again. Memory
 * only; Refresh and a page reload read afresh.
 */
const settledFiles = new Map<
  string,
  {
    state: ExpertMemberState;
    mutations: readonly HydratedFileMutation[];
  }
>();
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
  memberClient = null,
}: ExpertCenterProps) {
  const t = useUiText();
  const id = useId();
  const snapshot = useSyncExternalStore(
    manager?.subscribe ?? subscribeNothing,
    manager?.getSnapshot ?? emptySnapshot,
    manager?.getSnapshot ?? emptySnapshot,
  );
  // Memory only: what each member's own session last said about its turns.
  const [turns, setTurns] = useState<ReadonlyMap<string, MemberTurnRead>>(
    () => new Map(),
  );
  const [stopping, setStopping] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [stopFailed, setStopFailed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // Memory only: the file changes each writing team's members recorded.
  const [files, setFiles] = useState<
    ReadonlyMap<string, readonly HydratedFileMutation[]>
  >(() => new Map());
  const filesRead = useRef(new Map<string, ExpertMemberState>());
  const teams = useMemo(
    () => expertTeams(snapshot.blackboard, roster, workspace, turns, files),
    [snapshot.blackboard, roster, workspace, turns, files],
  );
  // Callers pass fresh callbacks each render; reads go through the latest
  // ones without re-running the arrival effect.
  const latest = useRef({ roster, turns, memberClient, profileId });
  latest.current = { roster, turns, memberClient, profileId };
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

  const memberSession = (topic: string) => {
    try {
      return peerIdentityForTopic(latest.current.profileId, topic);
    } catch {
      // A profile id the protocol cannot address has no member session.
      return null;
    }
  };
  const readMembers = useCallback(
    async (members: readonly { slug: string; topic: string }[]) => {
      const client = latest.current.memberClient;
      if (!client || !members.length) return;
      const reads = await Promise.all(
        members.map(async ({ slug, topic }) => {
          let sessionId: string;
          try {
            sessionId = peerIdentityForTopic(latest.current.profileId, topic);
          } catch {
            return null;
          }
          const last = lastMemberTurn(
            await readMemberTurns(client, sessionId).catch(() => null),
          );
          return last ? ([slug, last] as const) : null;
        }),
      );
      // An unreadable member keeps what was known; nothing is guessed.
      setTurns((current) => {
        const next = new Map(current);
        for (const read of reads) if (read) next.set(read[0], read[1]);
        return next;
      });
    },
    [],
  );

  const refresh = useCallback(
    (force = false) => {
      if (!manager) return;
      if (force) {
        filesRead.current.clear();
        settledFiles.clear();
      }
      void manager
        .gather()
        .catch(() => null)
        .then(() =>
          readMembers(
            membersToRead(
              expertTeams(
                manager.getSnapshot().blackboard,
                latest.current.roster,
                workspace,
                latest.current.turns,
              ),
              latest.current.turns,
              force,
            ),
          ),
        )
        .finally(() => setReadOnce(true));
    },
    [manager, readMembers, workspace],
  );

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
  // Read what each member of a writing team changed once its turn is over;
  // what it says it wrote is not taken on trust.
  useEffect(() => {
    if (!memberClient) return;
    const due = teams
      .filter((team) => teamWrites(team.template))
      .flatMap((team) => team.members)
      .filter(
        (member) =>
          FILES_SETTLED.has(member.state) &&
          filesRead.current.get(member.slug) !== member.state,
      );
    for (const member of due) {
      filesRead.current.set(member.slug, member.state);
      const sessionId = memberSession(member.topic);
      if (!sessionId) continue;
      const known = settledFiles.get(sessionId);
      if (known?.state === member.state) {
        setFiles((current) =>
          new Map(current).set(member.slug, known.mutations),
        );
        continue;
      }
      void readMemberFiles(memberClient, sessionId)
        .catch(() => null)
        .then((mutations) => {
          // An unreadable member keeps what was known; Refresh reads it again.
          if (!mutations) return;
          settledFiles.set(sessionId, { state: member.state, mutations });
          setFiles((current) => new Map(current).set(member.slug, mutations));
        });
    }
  });

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

  const canStopMember = (member: ExpertMemberView) =>
    canStop &&
    STOPPABLE.has(member.state) &&
    (member.entry?.status === "started" ||
      (!!member.runningTurn && !!memberClient));

  /**
   * A member this tab holds stops through its own session controller. One it
   * does not hold stops by the running turn its session reported, so a newer
   * turn or another member is never touched; nothing is sent again on its own.
   */
  const stopMember = async (member: ExpertMemberView) => {
    if (member.entry?.status === "started") {
      onStopMember(member.entry);
      return;
    }
    const sessionId = memberSession(member.topic);
    const turnId = member.runningTurn;
    if (!sessionId || !turnId || !memberClient || stopping.has(member.slug))
      return;
    const without = (set: ReadonlySet<string>) =>
      new Set([...set].filter((slug) => slug !== member.slug));
    setStopping((current) => new Set(current).add(member.slug));
    setStopFailed(without);
    const outcome = await stopMemberTurn(memberClient, sessionId, turnId);
    if (outcome === "failed")
      setStopFailed((current) => new Set(current).add(member.slug));
    // Whatever the answer, show what the member's session says now.
    await readMembers([member]);
    setStopping(without);
    refresh();
  };

  const memberRow = (team: ExpertTeamView, member: ExpertMemberView) => {
    const stoppable = canStopMember(member);
    const pendingStop = stopping.has(member.slug);
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
          <div className={styles.excerpt}>
            <MarkdownBody text={member.result} />
          </div>
        ) : member.state === "finished" ? (
          <p className={styles.hint}>
            {t("The answer is still being saved. It shows up here shortly.")}
          </p>
        ) : null}
        {member.files?.map((file) =>
          file.teamCopy ? (
            <p key={file.path} className={styles.file}>
              {t("New file:")}
              <code>{file.path}</code>
            </p>
          ) : (
            <p key={file.path} className={styles.error}>
              {file.deleted
                ? t(
                    "It deleted {path}. The team was told to leave existing files alone.",
                    { path: file.path },
                  )
                : t(
                    "It changed {path}, which is not the team's new copy. The team was told to leave existing files alone; check that file.",
                    { path: file.path },
                  )}
            </p>
          ),
        )}
        {member.writes &&
        member.files &&
        member.state === "finished" &&
        !member.files.some((file) => file.teamCopy) ? (
          <p className={styles.hint}>
            {t(
              "The server recorded no new file from this expert, whatever its answer says.",
            )}
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
        {stopFailed.has(member.slug) ? (
          <p className={styles.hint} role="alert">
            {t("It could not be stopped. Try again.")}
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
              disabled={pendingStop}
              onClick={() => void stopMember(member)}
            >
              {pendingStop ? t("Stopping…") : t("Stop")}
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
    const stoppable = team.members.filter(
      (member) => canStopMember(member) && !stopping.has(member.slug),
    );
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
                for (const member of stoppable) void stopMember(member);
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
                onClick={() => refresh(true)}
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
              onClick={() => refresh(true)}
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
              const writer =
                template.members.find((member) => member.writes) ?? null;
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
                            <dd>
                              <p>{t(member.focus)}</p>
                              {member.input ? (
                                <p className={styles.io}>
                                  {t("Works from: {input}", {
                                    input: t(member.input),
                                  })}
                                </p>
                              ) : null}
                              {member.output ? (
                                <p className={styles.io}>
                                  {t("Hands back: {output}", {
                                    output: t(member.output),
                                  })}
                                </p>
                              ) : null}
                            </dd>
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
                        {template.costNote ? (
                          <span className={styles.costNote}>
                            {t(template.costNote)}
                          </span>
                        ) : null}
                      </p>
                      <p className={styles.hint}>
                        {writer
                          ? t(
                              "They work in {workspace}. {writer} writes its result to a new file next to the original; the others only read, and nobody is to change the original. The page cannot enforce this. It shows the file changes the server recorded from each expert's file tools; changes made with shell commands are not recorded.",
                              {
                                workspace: workspaceLabel,
                                writer: t(writer.label),
                              },
                            )
                          : t(
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
