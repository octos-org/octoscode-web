import {
  AUTONOMY_NOTIFICATION_METHODS,
  goalEventGenerationAdmits,
  parseAutonomyNotification,
} from "./client-contract.ts";
import type {
  AgentArtifactSelector,
  AutonomyNotification,
  RpcNotification,
  SessionAutonomyCommands,
} from "./client-contract.ts";
import {
  applyAutonomyNotification,
  EMPTY_AUTONOMY,
  OperationTracker,
  resetAutonomyForSession,
  type AutonomyRuntimeState,
} from "./model.ts";
import type { LoopCreationInput } from "./loop-creation.ts";

/**
 * React-free autonomy engine. Owns state, busy-flag ownership, per-resource
 * request gates and revisions, the command-identity authority epoch, and
 * #1959 goal-generation admission — every ordering invariant is
 * unit-testable without a renderer. `useAutonomy` is a thin subscription
 * wrapper.
 */
export interface AutonomyStoreDeps {
  /** Root: `client.autonomyCommands(sessionId, capabilities)` — or null. */
  commands: () => SessionAutonomyCommands | null;
  sessionId: () => string | null;
  /** Immediate captured record/full runtime authority fence, before React rerenders. */
  isCurrent?: () => boolean;
}

export type LoopAction = "pause" | "resume" | "delete" | "fire_now";
export type MonitorAction = "pause" | "resume" | "delete";
export type GoalAction = "pause" | "resume" | "stop";
export type AgentAction = "interrupt" | "close";

type ErrorSlot = "goalError" | "loopsError" | "monitorsError" | "agentsError";

type BusyFlag =
  | "goalBusy"
  | "loopsBusy"
  | "monitorsBusy"
  | "agentsBusy"
  | "agentOutputBusy"
  | "agentDetailBusy";

/** Resources whose refresh snapshots are revision-guarded per resource. */
type RefreshResource = "goal" | "loops" | "monitors" | "agents";
type Resource = RefreshResource | "agent-output" | "agent-detail";

export interface MonitorInput {
  name: string;
  argv: string[];
  filterRegex?: string;
  mode: "poll" | "stream";
  intervalSeconds?: number;
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

const LOOP_ACTIVITY: Record<LoopAction, (id: string) => string> = {
  pause: (id) => `Loop ${id} paused`,
  resume: (id) => `Loop ${id} resumed`,
  delete: (id) => `Loop ${id} deleted`,
  fire_now: (id) => `Loop ${id} fired`,
};

const MONITOR_ACTIVITY: Record<MonitorAction, (id: string) => string> = {
  pause: (id) => `Monitor ${id} paused`,
  resume: (id) => `Monitor ${id} resumed`,
  delete: (id) => `Monitor ${id} deleted`,
};

export class AutonomyStore {
  #state: AutonomyRuntimeState;
  #listeners = new Set<(state: AutonomyRuntimeState) => void>();
  /** Per-gate-key request trackers: resource id or "refresh". */
  #ops = new OperationTracker();
  /** Command-identity epoch; bumped on ANY identity change. */
  #epoch = 0;
  #seenCommands: SessionAutonomyCommands | null = null;
  /** Per-resource revision: applied owning mutations/notifications bump. */
  #revisions = new Map<Resource, number>();
  /**
   * Busy-flag OWNERSHIP: flag → set of gate keys currently holding it. The
   * visible flag is derived (non-empty holders). A completing operation
   * releases only its own hold, so a refresh can never clear a concurrent
   * mutation's busy flag and a stale refresh (R1) never unlocks a newer
   * refresh's (R2).
   */
  #busyHolders = new Map<BusyFlag, Set<string>>();
  /** Actual in-flight writes, including an older superseded same-resource RPC. */
  #pendingWrites = new Set<symbol>();
  #deps: AutonomyStoreDeps;
  #active = true;

  constructor(deps: AutonomyStoreDeps) {
    this.#deps = deps;
    this.#state = resetAutonomyForSession(deps.sessionId());
  }

  /** Called every render by the hook; stores deps without notifying. */
  setDeps(deps: AutonomyStoreDeps): void {
    this.#deps = deps;
    // Render-time authority fence: an identity change resets IMMEDIATELY
    // (data + watermark + revisions + busy) — never carried until the next
    // op. Listeners are notified off-render (React-safe).
    if (deps.commands() !== this.#seenCommands) {
      this.#syncAuthority(true);
    }
  }

  getState = (): AutonomyRuntimeState => this.#state;

  /** Effect leases are reversible for React StrictMode, but never revive old work. */
  resume = (): void => {
    this.#active = true;
  };
  suspend = (): void => {
    this.#active = false;
    this.#ops.invalidateAll();
    this.#busyHolders.clear();
    this.#pendingWrites.clear();
    this.#applyBusyFlags();
  };

  #isCurrent(): boolean {
    return this.#active && (this.#deps.isCurrent?.() ?? true);
  }

  /** Synchronous close guard: reads may be abandoned, dispatched writes may not. */
  isMutationPending = (): boolean => this.#pendingWrites.size > 0;

  subscribe = (
    listener: (state: AutonomyRuntimeState) => void,
  ): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  get sessionId(): string | null {
    return this.#state.sessionId;
  }

  /**
   * Current authority epoch. Notification feeders capture this when their
   * connection subscribes and pass it back via
   * {@link observeNotification}: a frame captured under an older epoch
   * (pre-reauth client, dead socket) is rejected even when its session id
   * matches — commands-existence alone is not a sufficient fence.
   */
  get authorityEpoch(): number {
    return this.#epoch;
  }

  #set(updater: (current: AutonomyRuntimeState) => AutonomyRuntimeState): void {
    const next = updater(this.#state);
    if (next === this.#state) return;
    this.#state = next;
    for (const listener of this.#listeners) listener(next);
  }

  #holdBusy(gateKey: string, flags: readonly BusyFlag[]): void {
    for (const flag of flags) {
      const holders = this.#busyHolders.get(flag) ?? new Set<string>();
      holders.add(gateKey);
      this.#busyHolders.set(flag, holders);
    }
    this.#applyBusyFlags();
  }

  #releaseBusy(gateKey: string, flags: readonly BusyFlag[]): void {
    for (const flag of flags) {
      this.#busyHolders.get(flag)?.delete(gateKey);
    }
    this.#applyBusyFlags();
  }

  #applyBusyFlags(): void {
    const busy = (flag: BusyFlag): boolean =>
      (this.#busyHolders.get(flag)?.size ?? 0) > 0;
    this.#set((current) => ({
      ...current,
      goalBusy: busy("goalBusy"),
      loopsBusy: busy("loopsBusy"),
      monitorsBusy: busy("monitorsBusy"),
      agentsBusy: busy("agentsBusy"),
      agentOutputBusy: busy("agentOutputBusy"),
      agentDetailBusy: busy("agentDetailBusy"),
    }));
  }

  #revision(resource: Resource): number {
    return this.#revisions.get(resource) ?? 0;
  }

  #bump(resource: Resource): void {
    this.#revisions.set(resource, this.#revision(resource) + 1);
  }

  /**
   * Full authority check. ANY commands-identity change — a new object for
   * the same session, re-auth, reconnect, or a Core daemon restart
   * (in-memory generations restart lower, so the old watermark is invalid)
   * — resets ALL data, the goal watermark, revisions, busy holders, and
   * pending markers. Root mounts per session key; a stale store must never
   * survive an identity change under the same session id.
   */
  #syncAuthority(deferNotify = false): SessionAutonomyCommands | null {
    const commands = this.#deps.commands();
    if (commands === this.#seenCommands) return commands;
    const hadAny = this.#seenCommands !== null || commands !== null;
    this.#seenCommands = commands;
    this.#epoch += 1;
    this.#ops.invalidateAll();
    this.#revisions.clear();
    this.#busyHolders.clear();
    this.#pendingWrites.clear();
    if (hadAny) {
      const next = resetAutonomyForSession(this.#deps.sessionId());
      if (next !== this.#state) {
        this.#state = next;
        if (deferNotify) {
          const snapshot = this.#state;
          // Snapshot the listener set before deferring: a listener may
          // unsubscribe inside another's microtask.
          const listeners = Array.from(this.#listeners);
          for (const listener of listeners) {
            queueMicrotask(() => listener(snapshot));
          }
        } else {
          for (const listener of this.#listeners) listener(next);
        }
      }
    }
    return commands;
  }

  #authorized(
    gateKey: string,
    token: number,
    epoch: number,
    commands: object,
  ): boolean {
    return (
      this.#isCurrent() &&
      this.#ops.isCurrent(gateKey, token) &&
      this.#epoch === epoch &&
      this.#deps.commands() === commands
    );
  }

  #bound(sessionId: string): boolean {
    return (
      this.#deps.sessionId() === sessionId &&
      this.#state.sessionId === sessionId
    );
  }

  #runGuarded<T>(
    gateKey: string,
    errorSlot: ErrorSlot,
    busyFlags: readonly BusyFlag[],
    resource: Resource,
    markPending: (current: AutonomyRuntimeState) => AutonomyRuntimeState,
    clearPending: (current: AutonomyRuntimeState) => AutonomyRuntimeState,
    work: (
      commands: SessionAutonomyCommands,
      isCurrent: () => boolean,
    ) => Promise<T>,
    apply: (result: T, current: AutonomyRuntimeState) => AutonomyRuntimeState,
  ): Promise<T | null> {
    const commands = this.#syncAuthority();
    const sessionId = this.#deps.sessionId();
    const token = this.#ops.begin(gateKey);
    const epoch = this.#epoch;
    if (
      !this.#isCurrent() ||
      !commands ||
      !sessionId ||
      commands.sessionId !== sessionId ||
      this.#state.sessionId !== sessionId
    ) {
      // Nothing was marked pending; the tracker entry is inert.
      return Promise.resolve(null);
    }
    const write =
      resource === "agent-output" || resource === "agent-detail"
        ? null
        : Symbol(gateKey);
    if (write) this.#pendingWrites.add(write);
    this.#holdBusy(gateKey, busyFlags);
    this.#set(markPending);
    const isCurrent = () =>
      this.#authorized(gateKey, token, epoch, commands) &&
      this.#bound(sessionId);
    return work(commands, isCurrent)
      .then((result) => {
        if (
          !this.#authorized(gateKey, token, epoch, commands) ||
          !this.#bound(sessionId)
        ) {
          return null;
        }
        const before = this.#state;
        this.#set((current) => apply(result, current));
        if (this.#state === before) return null;
        // Revision authority takes effect SYNCHRONOUSLY with the accepted
        // apply: any refresh that reads its revision after this tick sees
        // the mutation and is superseded for this resource. A queued flush
        // here previously let a same-tick refresh clobber an accepted goal
        // set with its pre-mutation snapshot.
        this.#bump(resource);
        return result;
      })
      .catch((reason: unknown) => {
        if (
          this.#authorized(gateKey, token, epoch, commands) &&
          this.#bound(sessionId)
        ) {
          this.#set((current) => ({
            ...current,
            [errorSlot]: errorMessage(reason),
          }));
        }
        return null;
      })
      .finally(() => {
        const releasedWrite =
          write !== null && this.#pendingWrites.delete(write);
        // Only the OWNING request releases: a newer op on the same gate key
        // re-held the flags for itself (token check fails for this one), and
        // an epoch change already cleared every holder in #syncAuthority.
        if (this.#ops.isCurrent(gateKey, token)) {
          this.#releaseBusy(gateKey, busyFlags);
          this.#set(clearPending);
        } else if (releasedWrite) {
          // A superseded write still held the close guard even though it no
          // longer owned presentation flags. Publish its real completion.
          this.#set((current) => ({ ...current }));
        }
      });
  }

  /**
   * Re-read goal/loops/monitors/agents. Busy flags are held under the
   * shared "refresh" gate, so a stale refresh (superseded by a newer one)
   * never releases them, and refresh completion never clears a concurrent
   * mutation's hold. Each family is revision-guarded per resource: only an
   * applied owning notification/mutation on the SAME resource supersedes
   * that family's snapshot.
   */
  refresh(): Promise<void> {
    const commands = this.#syncAuthority();
    const sessionId = this.#deps.sessionId();
    if (
      !this.#isCurrent() ||
      !commands ||
      !sessionId ||
      commands.sessionId !== sessionId ||
      this.#state.sessionId !== sessionId
    ) {
      return Promise.resolve();
    }
    const caps = commands.capabilities;
    if (
      !caps.goalGet &&
      !caps.loopList &&
      !caps.monitorList &&
      !caps.agentList
    ) {
      return Promise.resolve();
    }
    const token = this.#ops.begin("refresh");
    const epoch = this.#epoch;
    const busyFlags: BusyFlag[] = [];
    if (caps.goalGet) busyFlags.push("goalBusy");
    if (caps.loopList) busyFlags.push("loopsBusy");
    if (caps.monitorList) busyFlags.push("monitorsBusy");
    if (caps.agentList) busyFlags.push("agentsBusy");
    const revisionAtRead: Record<RefreshResource, number> = {
      goal: this.#revision("goal"),
      loops: this.#revision("loops"),
      monitors: this.#revision("monitors"),
      agents: this.#revision("agents"),
    };
    this.#holdBusy("refresh", busyFlags);
    return Promise.allSettled([
      caps.goalGet ? commands.goal.read() : null,
      caps.loopList ? commands.loop.list() : null,
      caps.monitorList ? commands.monitor.list() : null,
      caps.agentList ? commands.agent.list() : null,
    ]).then(([goal, loops, monitors, agents]) => {
      if (
        !this.#isCurrent() ||
        !this.#ops.isCurrent("refresh", token) ||
        this.#epoch !== epoch ||
        this.#deps.commands() !== commands ||
        this.#deps.sessionId() !== sessionId ||
        this.#state.sessionId !== sessionId
      ) {
        // A newer refresh/authority owns the busy holds now; ours stay held
        // by the newer op's gate and are released by it.
        return;
      }
      const applyFamily = <T>(
        family: PromiseSettledResult<T | null>,
        resource: RefreshResource,
        apply: (
          value: T,
        ) => (current: AutonomyRuntimeState) => AutonomyRuntimeState,
        errorSlot: ErrorSlot,
      ): void => {
        // Per-resource guard: only an owning change supersedes this family.
        if (this.#revision(resource) !== revisionAtRead[resource]) return;
        if (family.status === "fulfilled" && family.value) {
          this.#set(apply(family.value));
        } else if (family.status === "rejected") {
          this.#set((current) => ({
            ...current,
            [errorSlot]: errorMessage(family.reason),
          }));
        }
      };
      applyFamily(
        goal,
        "goal",
        (value) => (current) => ({
          ...current,
          // The GET carries no generation; keep the #1959 watermark.
          goal: value.goal,
          goalError: null,
        }),
        "goalError",
      );
      applyFamily(
        loops,
        "loops",
        (value) => (current) => ({
          ...current,
          loops: value.loops,
          loopsError: null,
        }),
        "loopsError",
      );
      applyFamily(
        monitors,
        "monitors",
        (value) => (current) => ({
          ...current,
          monitors: value.monitors,
          monitorsError: null,
        }),
        "monitorsError",
      );
      applyFamily(
        agents,
        "agents",
        (value) => (current) => ({
          ...current,
          agents: value.agents,
          agentsError: null,
        }),
        "agentsError",
      );
      this.#releaseBusy("refresh", busyFlags);
    });
  }

  setGoal(objective: string, tokenBudget?: number): Promise<boolean> {
    return this.#runGuarded(
      "goal",
      "goalError",
      ["goalBusy"],
      "goal",
      (current) => current,
      (current) => current,
      (commands) => commands.goal.set(objective, tokenBudget),
      (result, current) => {
        // Generation admission: a stale set racing a newer clear must not
        // resurrect the cleared goal.
        if (
          !goalEventGenerationAdmits(current.goalGeneration, result.generation)
        ) {
          return current;
        }
        return {
          ...current,
          goal: result.goal,
          goalGeneration: result.generation,
          goalError: null,
          activity: `Goal ${result.goal.goal_id} set`,
        };
      },
    ).then((result) => result !== null);
  }

  clearGoal(): Promise<boolean> {
    return this.#runGuarded(
      "goal",
      "goalError",
      ["goalBusy"],
      "goal",
      (current) => current,
      (current) => current,
      (commands) => commands.goal.clear(),
      (result, current) => {
        if (
          !goalEventGenerationAdmits(current.goalGeneration, result.generation)
        ) {
          return current;
        }
        return {
          ...current,
          goal: null,
          goalGeneration: result.generation,
          goalError: null,
          activity: result.cleared
            ? "Session goal cleared"
            : "No active goal to clear",
        };
      },
    ).then((result) => result !== null);
  }

  /** TUI semantics: fresh goal/get, then user goal/set; never a browser goal loop. */
  transitionGoal(action: GoalAction): Promise<boolean> {
    const commands = this.#syncAuthority();
    const initialGoal = this.#state.goal;
    if (
      !commands?.capabilities.goalGet ||
      !commands.capabilities.goalSet ||
      this.#state.goalBusy ||
      !initialGoal ||
      !goalCanTransition(initialGoal.status)
    ) {
      return Promise.resolve(false);
    }
    const revision = this.#revision("goal");
    return this.#runGuarded(
      "goal",
      "goalError",
      ["goalBusy"],
      "goal",
      (current) => current,
      (current) => current,
      async (captured, isCurrent) => {
        const fresh = await captured.goal.read();
        if (
          !isCurrent() ||
          this.#revision("goal") !== revision ||
          this.#state.goal !== initialGoal
        ) {
          throw new Error(
            "The goal changed while it was being read. Refresh before trying again.",
          );
        }
        if (!fresh.goal || !goalCanTransition(fresh.goal.status)) {
          throw new Error("There is no current unfinished goal to change.");
        }
        return captured.goal.transition(
          fresh.goal.objective,
          action === "pause"
            ? "paused"
            : action === "resume"
              ? "active"
              : "complete",
        );
      },
      (result, current) => {
        if (
          !goalEventGenerationAdmits(current.goalGeneration, result.generation)
        )
          return current;
        return {
          ...current,
          goal: result.goal,
          goalGeneration: result.generation,
          goalError: null,
          activity: `Goal ${result.goal.goal_id} ${action === "pause" ? "paused" : action === "resume" ? "resumed" : "stopped"}`,
        };
      },
    ).then((result) => result !== null);
  }

  createLoop(
    input: string | LoopCreationInput,
    intervalSeconds?: number,
  ): Promise<boolean> {
    const captured =
      typeof input === "string"
        ? {
            prompt: input,
            ...(intervalSeconds === undefined
              ? {}
              : { interval_seconds: intervalSeconds }),
          }
        : { ...input };
    return this.#runGuarded(
      "loop:create",
      "loopsError",
      ["loopsBusy"],
      "loops",
      (current) => current,
      (current) => current,
      (commands) => commands.loop.create(captured),
      (result, current) => {
        // ID upsert (not blind prepend): a loop/updated notification may
        // already have landed for this id — replace, never duplicate.
        return {
          ...current,
          loops: upsertLoop(current.loops, result.loop),
          loopsError: null,
          activity: `Loop ${result.loop_id} created`,
        };
      },
    ).then((result) => result !== null);
  }

  controlLoop(loopId: string, action: LoopAction): Promise<boolean> {
    // Gate by RESOURCE id: competing pause/resume/delete on the same loop
    // share one gate, so they serialize coherently — the newest wins and an
    // older completion is dropped (never clearing the newer op's marker).
    return this.#runGuarded(
      `loop:${loopId}`,
      "loopsError",
      ["loopsBusy"],
      "loops",
      (current) => ({
        ...current,
        pendingLoopIds: new Set(current.pendingLoopIds).add(loopId),
      }),
      (current) => {
        const pending = new Set(current.pendingLoopIds);
        pending.delete(loopId);
        return { ...current, pendingLoopIds: pending };
      },
      (commands) => {
        switch (action) {
          case "pause":
            return commands.loop.pause(loopId);
          case "resume":
            return commands.loop.resume(loopId);
          case "delete":
            return commands.loop.delete(loopId);
          case "fire_now":
            return commands.loop.fireNow(loopId);
        }
      },
      (result, current) => {
        return {
          ...current,
          loops:
            action === "delete"
              ? current.loops.filter((entry) => entry.loop_id !== loopId)
              : upsertLoop(current.loops, result.loop),
          loopsError: null,
          activity: LOOP_ACTIVITY[action](loopId),
        };
      },
    ).then((result) => result !== null);
  }

  createMonitor(input: MonitorInput): Promise<boolean> {
    return this.#runGuarded(
      "monitor:create",
      "monitorsError",
      ["monitorsBusy"],
      "monitors",
      (current) => current,
      (current) => current,
      (commands) =>
        commands.monitor.create({
          name: input.name,
          argv: input.argv,
          ...(input.filterRegex ? { filter_regex: input.filterRegex } : {}),
          mode: input.mode,
          ...(input.mode === "poll" && input.intervalSeconds !== undefined
            ? { interval_seconds: input.intervalSeconds }
            : {}),
        }),
      (result, current) => {
        // ID upsert: a monitor/updated notification may have landed first.
        return {
          ...current,
          monitors: upsertMonitor(current.monitors, result.monitor),
          monitorsError: null,
          activity: `Monitor ${result.monitor_id} created`,
        };
      },
    ).then((result) => result !== null);
  }

  controlMonitor(monitorId: string, action: MonitorAction): Promise<boolean> {
    return this.#runGuarded(
      `monitor:${monitorId}`,
      "monitorsError",
      ["monitorsBusy"],
      "monitors",
      (current) => ({
        ...current,
        pendingMonitorIds: new Set(current.pendingMonitorIds).add(monitorId),
      }),
      (current) => {
        const pending = new Set(current.pendingMonitorIds);
        pending.delete(monitorId);
        return { ...current, pendingMonitorIds: pending };
      },
      (commands) => {
        switch (action) {
          case "pause":
            return commands.monitor.pause(monitorId);
          case "resume":
            return commands.monitor.resume(monitorId);
          case "delete":
            return commands.monitor.delete(monitorId);
        }
      },
      (result, current) => {
        return {
          ...current,
          monitors: result.deleted
            ? current.monitors.filter((entry) => entry.monitor_id !== monitorId)
            : upsertMonitor(current.monitors, result.monitor),
          monitorsError: null,
          activity: MONITOR_ACTIVITY[action](monitorId),
        };
      },
    ).then((result) => result !== null);
  }

  /**
   * Single agent-output selection gate: ONE output viewer. Reading agent B
   * supersedes an in-flight read of agent A at the gate level, so a late A
   * resolution can never revert B's result. The read cursor is bound to the
   * agent it was captured for.
   */
  readAgentOutput(agentId: string, loadMore = false): Promise<boolean> {
    const cursor =
      loadMore && this.#state.agentOutput?.agent_id === agentId
        ? (this.#state.agentOutput.next_cursor ?? undefined)
        : undefined;
    return this.#runGuarded(
      "agent-output",
      "agentsError",
      ["agentOutputBusy"],
      "agent-output",
      (current) => current,
      (current) => current,
      (commands) => commands.agent.readOutput(agentId, cursor),
      (result, current) => {
        // The result must belong to the agent this op requested.
        if (result.agent_id !== agentId) return current;
        return {
          ...current,
          agentOutput:
            loadMore &&
            current.agentOutput?.agent_id === agentId &&
            result.cursor
              ? { ...result, text: current.agentOutput.text + result.text }
              : result,
          agentsError: null,
        };
      },
    ).then((result) => result !== null);
  }

  /** One detail viewer: selecting another read invalidates every prior detail request. */
  readAgentStatus(agentId: string): Promise<boolean> {
    this.#syncAuthority();
    const revision = this.#revision("agents");
    return this.#runGuarded(
      "agent-detail",
      "agentsError",
      ["agentDetailBusy"],
      "agent-detail",
      clearAgentDetail,
      (current) => current,
      (commands) => commands.agent.readStatus(agentId),
      (result, current) =>
        revision !== this.#revision("agents")
          ? current
          : { ...current, agentStatus: result.agent, agentsError: null },
    ).then((result) => result !== null);
  }

  listAgentArtifacts(agentId: string): Promise<boolean> {
    this.#syncAuthority();
    const revision = this.#revision("agents");
    return this.#runGuarded(
      "agent-detail",
      "agentsError",
      ["agentDetailBusy"],
      "agent-detail",
      clearAgentDetail,
      (current) => current,
      (commands) => commands.agent.listArtifacts(agentId),
      (result, current) =>
        revision !== this.#revision("agents")
          ? current
          : { ...current, agentArtifacts: result, agentsError: null },
    ).then((result) => result !== null);
  }

  readAgentArtifact(
    agentId: string,
    selector: AgentArtifactSelector,
  ): Promise<boolean> {
    this.#syncAuthority();
    const revision = this.#revision("agents");
    // Capture the selector; mutating the caller's object must never retarget a read.
    const captured = { ...selector };
    return this.#runGuarded(
      "agent-detail",
      "agentsError",
      ["agentDetailBusy"],
      "agent-detail",
      clearAgentDetail,
      (current) => current,
      (commands) => commands.agent.readArtifact(agentId, captured),
      (result, current) =>
        revision !== this.#revision("agents")
          ? current
          : { ...current, agentArtifact: result, agentsError: null },
    ).then((result) => result !== null);
  }

  controlAgent(agentId: string, action: AgentAction): Promise<boolean> {
    this.#syncAuthority();
    if (this.#state.pendingAgentIds.has(agentId)) return Promise.resolve(false);
    return this.#runGuarded(
      `agent:${agentId}`,
      "agentsError",
      ["agentsBusy"],
      "agents",
      (current) => ({
        ...current,
        pendingAgentIds: new Set(current.pendingAgentIds).add(agentId),
      }),
      (current) => {
        const pendingAgentIds = new Set(current.pendingAgentIds);
        pendingAgentIds.delete(agentId);
        return { ...current, pendingAgentIds };
      },
      (commands) =>
        action === "interrupt"
          ? commands.agent.interrupt(agentId)
          : commands.agent.close(agentId),
      (result, current) => ({
        ...current,
        agents: current.agents.map((agent) =>
          agent.agent_id === result.agent_id
            ? { ...agent, status: result.status }
            : agent,
        ),
        agentStatus:
          current.agentStatus?.agent_id === result.agent_id
            ? { ...current.agentStatus, status: result.status }
            : current.agentStatus,
        agentsError: null,
        activity: `Agent ${result.agent_id} ${result.status}`,
      }),
    ).then((result) => result !== null);
  }

  /**
   * Authority-fenced notification observer. An owning event bumps only its
   * OWN resource revision; a foreign/background event (activity line only)
   * never invalidates any refresh snapshot.
   */
  observeNotification(
    notification: RpcNotification,
    capturedEpoch?: number,
  ): void {
    if (!AUTONOMY_NOTIFICATION_METHODS.includes(notification.method)) return;
    // A source callback may arrive between dependency replacement and render.
    // Synchronize BEFORE admitting its captured epoch, never after admission.
    const commands = this.#syncAuthority();
    // Epoch admission: a frame captured under an older authority epoch is a
    // late old-client frame; drop it before it can poison the new store.
    if (capturedEpoch !== undefined && capturedEpoch !== this.#epoch) return;
    // Fail closed FIRST: with no active command authority in the current
    // epoch (session closed / disconnected / unnegotiated), a notification —
    // however fresh its session id — must never repopulate state. The old
    // socket's late frames cannot resurrect cleared data.
    if (commands === null || !this.#isCurrent()) return;
    const parsed = parseAutonomyNotification(notification);
    if (!parsed) return;
    const before = this.#state;
    this.#set((current) =>
      applyAutonomyNotification(current, parsed, this.#deps.sessionId()),
    );
    const after = this.#state;
    if (after === before) return;
    if (parsed.event.session_id !== this.#deps.sessionId()) return;
    // Only an OWNING event that actually changed FAMILY DATA invalidates
    // that family's refresh snapshot. An activity-only event (Core emits
    // scheduler `loop/fired` with `loop_state: None`, so the reducer only
    // touched the activity line) must NOT bump the loops revision and
    // discard a valid in-flight list.
    const resource = notificationResource(parsed);
    const familyDataChanged =
      resource === "goal"
        ? after.goal !== before.goal ||
          after.goalGeneration !== before.goalGeneration
        : resource === "loops"
          ? after.loops !== before.loops
          : resource === "monitors"
            ? after.monitors !== before.monitors
            : resource === "agents"
              ? after.agents !== before.agents
              : after.agentOutput !== before.agentOutput;
    if (familyDataChanged) {
      this.#bump(resource);
    }
  }
}

function notificationResource(notification: AutonomyNotification): Resource {
  switch (notification.kind) {
    case "goal_updated":
    case "goal_cleared":
      return "goal";
    case "loop_updated":
    case "loop_fired":
    case "loop_completed":
      return "loops";
    case "monitor_updated":
    case "monitor_fired":
    case "monitor_expired":
      return "monitors";
    case "agent_updated":
      return "agents";
  }
}

function upsertLoop(
  loops: AutonomyRuntimeState["loops"],
  record: AutonomyRuntimeState["loops"][number],
): AutonomyRuntimeState["loops"] {
  const index = loops.findIndex((entry) => entry.loop_id === record.loop_id);
  if (index < 0) return [record, ...loops];
  const next = loops.slice();
  next[index] = record;
  return next;
}

function upsertMonitor(
  monitors: AutonomyRuntimeState["monitors"],
  record: AutonomyRuntimeState["monitors"][number],
): AutonomyRuntimeState["monitors"] {
  const index = monitors.findIndex(
    (entry) => entry.monitor_id === record.monitor_id,
  );
  if (index < 0) return [record, ...monitors];
  const next = monitors.slice();
  next[index] = record;
  return next;
}

export { EMPTY_AUTONOMY };

function goalCanTransition(status: string): boolean {
  return ["active", "paused", "budget_limited", "blocked"].includes(status);
}

function clearAgentDetail(current: AutonomyRuntimeState): AutonomyRuntimeState {
  return {
    ...current,
    agentStatus: null,
    agentArtifacts: null,
    agentArtifact: null,
    agentsError: null,
  };
}
