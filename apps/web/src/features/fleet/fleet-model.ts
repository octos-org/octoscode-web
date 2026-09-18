/**
 * fleet-model — the PURE model of the Fleet view (program
 * WEB-UX-PROGRAM-4000 goal 3; design WEB-UX-DESIGN-4000 §3, §4.3, §8; grant
 * GLM-WEB-UX2-FLEET-VIEW-4010).
 *
 * Everything here is PURE (no React, no I/O) so it runs under node — apps/web
 * has no jsdom. Types owned by the view are imported TYPE-ONLY so this module
 * never adds a runtime edge back into React code.
 *
 * The Fleet view is the operator surface over peers the connected server
 * exposes: grouped by goal when a dispatch carried a goal id, else one flat
 * "Peers" group; ordered waiting-for-you first, then working, then starting,
 * then finished; terminal rows collapse under "Finished (n)" and stay for the
 * session's lifetime. Copy is product words — no protocol vocabulary (lane →
 * model, slug → peer name, operation ids hidden).
 */

/** The design's status vocabulary (§4.3), in §3's ordering rank. */
export type FleetStatusWord =
  | "Requested"
  | "Starting"
  | "Still starting…"
  | "Working"
  | "Waiting for your approval"
  | "Waiting for your answer"
  | "Finished"
  | "Stopped"
  | "Failed"
  | "Outcome unknown";

/**
 * §3 ordering: waiting for you first, then working, then starting, then
 * finished. The list carries the DESIGN's canonical status words in rank
 * order; derived variants ("Still starting…", "Requested", "Outcome unknown")
 * alias into these ranks through RANK_ALIAS below. Stopped/Failed/Outcome
 * unknown are the terminal tail of the "finished" rank family, so they
 * collapse into the Finished (n) bucket too.
 */
export const FLEET_STATUS_ORDER: readonly FleetStatusWord[] = Object.freeze([
  "Waiting for your approval",
  "Waiting for your answer",
  "Working",
  "Starting",
  "Finished",
  "Stopped",
  "Failed",
]);

/** Rank aliases for the derived (non-canonical) status words. */
const RANK_ALIAS: Readonly<
  Record<
    Exclude<FleetStatusWord, (typeof FLEET_STATUS_ORDER)[number]>,
    FleetStatusWord
  >
> = Object.freeze({
  "Still starting…": "Starting",
  Requested: "Starting",
  "Outcome unknown": "Failed",
});

const STATUS_RANK: Readonly<Record<FleetStatusWord, number>> =
  Object.fromEntries([
    ...FLEET_STATUS_ORDER.map((word, index) => [word, index]),
    ...(Object.entries(RANK_ALIAS) as [string, FleetStatusWord][]).map(
      ([word, canonical]) => [word, FLEET_STATUS_ORDER.indexOf(canonical)],
    ),
  ]) as Readonly<Record<FleetStatusWord, number>>;

/** The statuses that belong to the collapsed "Finished (n)" retention bucket. */
export const FLEET_TERMINAL_STATUSES: readonly FleetStatusWord[] =
  Object.freeze(["Finished", "Stopped", "Failed", "Outcome unknown"]);

/** §4.3: "Still starting" fires once Starting exceeds 15 s. */
export const FLEET_SLOW_START_MS = 15_000;

/** One peer row the Fleet view renders. Every id is server-reported. */
export interface FleetRosterPeer {
  /** The row's stable key: the accepted dispatch's own slug. */
  readonly slug: string;
  /** "Peer N · <model>" — the accepted dispatch's resolved model. */
  readonly label: string;
  /** The brief-derived title: first line, 60 chars (§4.3). */
  readonly title: string;
  /** The design's status word (§4.3). */
  readonly statusWord: FleetStatusWord;
  /** The peer's adopted session id, for the row → transcript link. */
  readonly sessionId: string;
  /** The session's display name (workspace name). */
  readonly sessionName: string;
  /** The dispatch's goal id when known, else null (flat group). */
  readonly goalId: string | null;
  /** Elapsed ms since accepted. */
  readonly elapsedMs: number;
  /** Output tokens from the peer session's usage events; 0 until the first. */
  readonly tokens: number;
  /** Whether the server advertised the control methods the actions need. */
  readonly controlSupported: boolean;
}

/**
 * The event-driven phases the status words project from (§4.3). The phase is
 * derived from the peer's own Session events (never a profile stamp):
 * dispatch sent → Requested; accepted receipt → Starting; turn/started →
 * Working; approval/question → Waiting; decided/answered → Working;
 * turn/completed → Finished; turn/error interrupted → Stopped; other
 * turn/error → Failed; no receipt in 15 s / lost ack → Outcome unknown.
 */
export type FleetPhase =
  | "requested"
  | "starting"
  | "working"
  | "awaiting"
  | "finished"
  | "stopped"
  | "failed"
  | "unknown-outcome";

/** The waiting kind when the phase is `awaiting`. */
export type FleetAwaitKind = "approval" | "question";

/** The row ACTIVITY vocabulary the existing controller roster carries. */
export type FleetControllerActivity =
  "staged" | "live" | "blocked" | "done" | "reaped";

/** One controller roster row (PeerControllerRosterRow), re-typed locally. */
export interface FleetControllerRow {
  readonly slug: string;
  readonly operationId: string;
  readonly turnId: string;
  readonly activity: FleetControllerActivity;
  readonly control?: unknown;
}

/** Project the design's status word for one peer phase (§4.3). */
export function fleetStatusWord(
  input: {
    readonly phase: FleetPhase;
    readonly kind?: FleetAwaitKind;
    /** Wall-clock ms the Starting phase began (for the slow-start word). */
    readonly startedMs?: number;
  },
  now: number = Date.now(),
): FleetStatusWord {
  switch (input.phase) {
    case "requested":
      return "Requested";
    case "starting":
      return input.startedMs !== undefined &&
        now - input.startedMs > FLEET_SLOW_START_MS
        ? "Still starting…"
        : "Starting";
    case "working":
      return "Working";
    case "awaiting":
      return input.kind === "question"
        ? "Waiting for your answer"
        : "Waiting for your approval";
    case "finished":
      return "Finished";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    case "unknown-outcome":
      return "Outcome unknown";
  }
}

/**
 * Map the existing controller roster's ACTIVITY axis onto the fleet phase
 * vocabulary (a projection — never a second tracker):
 *   staged → Starting (dispatch accepted, no turn running yet)
 *   live → Working
 *   blocked → Waiting (kind decided by the row's own pending request)
 *   done / reaped → Finished
 */
export function fleetPhaseFromActivity(
  activity: FleetControllerActivity,
): FleetPhase {
  switch (activity) {
    case "staged":
      return "starting";
    case "live":
      return "working";
    case "blocked":
      return "awaiting";
    case "done":
    case "reaped":
      return "finished";
  }
}

/** The waiting kind for a blocked row: question only when it reported one. */
export function fleetAwaitKind(
  requestKind: "approval" | "question" | null | undefined,
): FleetAwaitKind {
  return requestKind === "question" ? "question" : "approval";
}

/** One group of peers: keyed by goal id when known, else the flat "Peers". */
export interface FleetPeerGroup {
  /** The dispatch's goal id, or null for the flat "Peers" group. */
  readonly goalId: string | null;
  /** Active rows in §3 order, stable within a rank. */
  readonly peers: readonly FleetRosterPeer[];
  /** Terminal rows (Finished/Stopped/Failed/Outcome unknown), oldest first. */
  readonly finished: readonly FleetRosterPeer[];
  /** The collapsed bucket's headline count: "Finished (n)". */
  readonly finishedCount: number;
}

/**
 * Group peers by goal (§3): one group per known goal id, insertion-ordered;
 * a peer without a goal id joins the flat "Peers" group (last if both kinds
 * are present). Within each group the §3 ordering applies and terminal rows
 * move to the group's collapsed Finished bucket. Ordering is STABLE: rows of
 * equal rank keep roster order (sort is stable in ES2023+).
 */
export function fleetGroupPeers(
  peers: readonly FleetRosterPeer[],
): FleetPeerGroup[] {
  const order: (string | null)[] = [];
  const buckets = new Map<string | null, FleetRosterPeer[]>();
  for (const peer of peers) {
    const key = peer.goalId;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(peer);
  }
  // The flat "Peers" group renders last when goal groups exist (goal groups
  // are the primary organization; goalless peers are the tail).
  if (order.includes(null) && order.length > 1) {
    order.splice(order.indexOf(null), 1);
    order.push(null);
  }
  return order.map((goalId) => {
    const members = buckets.get(goalId) ?? [];
    const ranked = [...members].sort(
      (a, b) => STATUS_RANK[a.statusWord] - STATUS_RANK[b.statusWord],
    );
    const active = ranked.filter(
      (peer) => !FLEET_TERMINAL_STATUSES.includes(peer.statusWord),
    );
    const finished = ranked.filter((peer) =>
      FLEET_TERMINAL_STATUSES.includes(peer.statusWord),
    );
    return {
      goalId,
      peers: active,
      finished,
      finishedCount: finished.length,
    };
  });
}

/** §4.3: the row title is the brief's first line, capped at 60 characters. */
export const FLEET_TITLE_MAX = 60;

export function fleetRowTitle(brief: string): string {
  const firstLine = brief.split("\n", 1)[0] ?? "";
  const trimmed = firstLine.trim();
  if (trimmed === "") return "Peer started";
  return trimmed.length > FLEET_TITLE_MAX
    ? trimmed.slice(0, FLEET_TITLE_MAX)
    : trimmed;
}

/**
 * Round 4 §C (4200d 08.png): the row's TITLE when no brief title exists. The
 * old placeholder "Peer started" contradicted a status line that said Working
 * (and the sidebar's "started") — one status word everywhere, from EVENTS. The
 * placeholder now names the peer with its EVENT-derived status word so the
 * title can never contradict the row's own status line.
 */
export function fleetRowFallbackTitle(
  peerName: string,
  statusWord: FleetStatusWord,
): string {
  return `${peerName} — ${statusWord}`;
}

/** The lane picker state the Start form reuses (peer-lane-source.ts). */
export type FleetLanePickerState =
  | { readonly kind: "disabled" }
  | { readonly kind: "ready"; readonly keys: readonly string[] };

/**
 * §4.3 Start gate: the ONLY implicit acquisition. Admitted only when the
 * model picker is ready with an advertised lane, the chosen lane is exactly
 * one advertised key, the brief is non-blank, and the server supports remote
 * control at all. The seat does NOT need to be pre-held: Start is itself the
 * implicit acquisition (§4.3) — it acquires control of the selected session
 * and then dispatches once. Fixes 4210: the pre-held requirement was a
 * product defect (walkthrough 4200 step 8; mock run 20's 8 peer-controller
 * reds all failed on Start staying disabled).
 */
export function fleetStartAdmitted(input: {
  readonly lanePicker: FleetLanePickerState;
  readonly lane: string;
  readonly brief: string;
  readonly controlSupported: boolean;
}): boolean {
  if (!input.controlSupported) return false;
  if (input.lanePicker.kind !== "ready") return false;
  if (!input.lanePicker.keys.includes(input.lane)) return false;
  return input.brief.trim() !== "";
}

/**
 * The display name for ONE advertised lane key (§4.3, Fixes 4210): "shows the
 * model name", never the lane key. The caller supplies the server-reported
 * model names when it has them (data-05's acceptance facts / a lane model
 * map); otherwise the key itself IS the model name except for the compacted
 * two-digit convention ('glm-53' → 'glm-5.3'), which the picker unfolds.
 */
export function fleetModelName(
  laneKey: string,
  modelNames?: Readonly<Record<string, string>>,
): string {
  const reported = modelNames?.[laneKey];
  if (typeof reported === "string" && reported !== "") return reported;
  const dotted = /^([a-z][a-z0-9]*)-([0-9])([0-9])$/i.exec(laneKey);
  if (dotted) return `${dotted[1]}-${dotted[2]}.${dotted[3]}`;
  return laneKey;
}

/** One picker option: the model NAME plus the key that dispatch targets. */
export interface FleetModelOption {
  readonly laneKey: string;
  /** The displayed model name (§4.3). */
  readonly label: string;
}

/**
 * The picker's options (§4.3, Fixes 4210): model NAMES with the lane key as a
 * muted suffix ONLY when two lanes share a model name (so the choice is still
 * unambiguous); otherwise the bare name.
 */
export function fleetModelOptions(
  laneKeys: readonly string[],
  modelNames?: Readonly<Record<string, string>>,
): FleetModelOption[] {
  const names = laneKeys.map((key) => fleetModelName(key, modelNames));
  const duplicates = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );
  return laneKeys.map((laneKey, index) => ({
    laneKey,
    label: duplicates.has(names[index]!)
      ? `${names[index]} (${laneKey})`
      : names[index]!,
  }));
}

/**
 * §4.3 action availability, mirrored from the design's table:
 *   Approve / Deny — only while Waiting for your approval
 *   Answer — only while Waiting for your answer (the question card owns it)
 *   Steer — inline text + button, enabled while Working AND text non-blank
 *   Stop — while Starting, Working, or either waiting state
 */
export function fleetActionAvailability(input: {
  readonly statusWord: FleetStatusWord;
  readonly steerText?: string;
}): { approve: boolean; deny: boolean; steer: boolean; stop: boolean } {
  const awaitingApproval = input.statusWord === "Waiting for your approval";
  const awaitingAnswer = input.statusWord === "Waiting for your answer";
  const working = input.statusWord === "Working";
  const starting =
    input.statusWord === "Starting" ||
    input.statusWord === "Still starting…" ||
    input.statusWord === "Requested";
  const stop = starting || working || awaitingApproval || awaitingAnswer;
  return {
    approve: awaitingApproval,
    deny: awaitingApproval,
    steer: working && (input.steerText ?? "").trim() !== "",
    stop,
  };
}

/**
 * Project the existing controller roster into fleet rows (§4.3). Rows are
 * numbered by roster order ("Peer N"); the accepted facts (model, title,
 * session name, goal id, elapsed, tokens) come from the caller's per-slug
 * acceptance map, never rebuilt from a slug. A reaped row (no accepted
 * operation id) keeps its display but offers no control.
 */
export function fleetRosterFromController(input: {
  readonly roster: readonly FleetControllerRow[];
  readonly facts?: Readonly<
    Record<
      string,
      {
        readonly number: number;
        readonly model: string | null;
        readonly title: string;
        readonly sessionName: string;
        readonly goalId: string | null;
        readonly elapsedMs: number;
        readonly tokens: number;
      }
    >
  >;
  /** The master session id rows link back to (defaults shown in tests). */
  readonly masterSessionId?: string;
}): FleetRosterPeer[] {
  const master = input.masterSessionId ?? "coding:local:tui";
  return input.roster.map((row, index) => {
    const facts = input.facts?.[row.slug];
    const number = facts?.number ?? index + 1;
    const model = facts?.model ?? null;
    const label =
      model && model !== "" ? `Peer ${number} · ${model}` : `Peer ${number}`;
    const phase = fleetPhaseFromActivity(row.activity);
    const statusWord = fleetStatusWord({
      phase,
      ...(phase === "awaiting" ? { kind: "approval" as const } : {}),
    });
    return {
      slug: row.slug,
      label,
      title: facts?.title ?? "Peer started",
      statusWord,
      sessionId: `${master}#${row.slug}`,
      sessionName: facts?.sessionName ?? "",
      goalId: facts?.goalId ?? null,
      elapsedMs: facts?.elapsedMs ?? 0,
      tokens: facts?.tokens ?? 0,
      controlSupported: row.operationId !== "",
    };
  });
}

/**
 * §8 live region: announce a peer that starts waiting for you, and a peer's
 * terminal outcome. Returns null when nothing the design asks to announce
 * changed between the previous and current rows.
 */
export function fleetAnnouncement(
  previous: readonly FleetRosterPeer[] | null,
  current: readonly FleetRosterPeer[],
): string | null {
  if (previous === null) return null;
  const before = new Map(previous.map((peer) => [peer.slug, peer.statusWord]));
  for (const peer of current) {
    if (before.get(peer.slug) === peer.statusWord) continue;
    if (peer.statusWord === "Waiting for your approval")
      return `${peer.label} is waiting for your approval`;
    if (peer.statusWord === "Waiting for your answer")
      return `${peer.label} is waiting for your answer`;
    if (peer.statusWord === "Finished") return `${peer.label} finished`;
    if (peer.statusWord === "Stopped") return `${peer.label} stopped`;
    if (peer.statusWord === "Failed") return `${peer.label} failed`;
  }
  return null;
}

/**
 * §8 Alt+D: navigate to Fleet and focus the Brief field; never fires while
 * focus is inside a text input (INPUT/TEXTAREA) or a dialog. The physical
 * `code` is matched first (layout-stable), with `key` as the fallback.
 */
export function fleetAltDActivates(event: {
  readonly altKey: boolean;
  readonly key: string;
  readonly code?: string;
  readonly target?: {
    readonly tagName?: string;
    readonly insideDialog?: boolean;
  } | null;
}): boolean {
  if (!event.altKey) return false;
  const isD = event.code === "KeyD" || event.key === "d" || event.key === "D";
  if (!isD) return false;
  const tag = event.target?.tagName ?? "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;
  if (event.target?.insideDialog === true) return false;
  return true;
}
