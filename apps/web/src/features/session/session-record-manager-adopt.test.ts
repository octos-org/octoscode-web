import { describe, expect, it } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type ConfigCapabilitiesListResult,
  type ConnectionStatus,
  type RpcNotification,
  type SessionHydrateParams,
  type SessionHydrateResult,
  type SessionOpenParams,
  type SessionOpenResult,
  type SessionOpened,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  SessionRecordManager,
  type SessionRecord,
} from "./session-record-manager.ts";
import type { SessionRuntimeScope } from "./session-scope.ts";

/**
 * P1 `adoptOnRecord` RED. `openOnRecord` is `session/open`-based and hard-
 * validates the STAGING request id (`nextOpened.session_id === config.sessionId`),
 * so a server-ADOPTED peer id — minted by Core, never requested here — can never
 * be installed. `adoptOnRecord` installs the DECLARED adopted identity instead:
 * ensure the disclosed scope, open exactly that id on the pooled transport,
 * install WITHOUT the staging-id equality assert, and mark the adopted turn as
 * the record's live turn. It must be idempotent for a replayed receipt and must
 * refuse a scope that names a different Session.
 */

const TURN = "0198e6c1-2f3b-7c9a-b1d4-5f2a8c7e9d01";
const ADOPTED = "coding:local:tui#peer-alpha";
const FOREIGN = "coding:local:tui#peer-beta";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.SESSION_OPEN,
    CORE_UI_METHODS.SESSION_HYDRATE,
    CORE_UI_METHODS.TURN_START,
    CORE_UI_METHODS.TURN_INTERRUPT,
  ],
  supported_notifications: [],
  supported_features: [
    CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
    CORE_UI_FEATURES.USER_QUESTION_V1,
  ],
};

function hydrate(
  sessionId: string,
  over: Partial<SessionHydrateResult> = {},
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: 1 },
    turns: [],
    ...over,
  };
}

/** Minimal pooled transport: the SAME socket the dispatch receipt arrived on. */
class PooledClient {
  status: ConnectionStatus = "connected";
  readonly opens: SessionOpenParams[] = [];
  readonly hydrates: SessionHydrateParams[] = [];
  readonly notifications = new Set<(n: RpcNotification) => void>();
  readonly statuses = new Set<(status: ConnectionStatus) => void>();
  openedFor: (sessionId: string) => SessionOpened = (sessionId) => ({
    session_id: sessionId,
    active_profile_id: "coding",
    workspace_root: "/srv/project",
    capabilities: caps,
  });
  hydratedFor: (sessionId: string) => SessionHydrateResult = hydrate;
  async connect() {
    this.setStatus("connected");
  }
  disconnect() {
    this.setStatus("disconnected");
  }
  setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of Array.from(this.statuses)) listener(status);
  }
  subscribeStatus(listener: (status: ConnectionStatus) => void) {
    this.statuses.add(listener);
    listener(this.status);
    return () => this.statuses.delete(listener);
  }
  subscribeErrors() {
    return () => undefined;
  }
  subscribeNotifications(listener: (n: RpcNotification) => void) {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }
  async listConfigCapabilities(): Promise<ConfigCapabilitiesListResult> {
    return { capabilities: caps };
  }
  async openSession(params: SessionOpenParams): Promise<SessionOpenResult> {
    this.opens.push(params);
    return { opened: this.openedFor(params.session_id) };
  }
  async hydrateSession(
    params: SessionHydrateParams,
  ): Promise<SessionHydrateResult> {
    this.hydrates.push(params);
    return this.hydratedFor(params.session_id);
  }
  async startTurn(): Promise<unknown> {
    return {};
  }
  async interruptTurn(): Promise<unknown> {
    return {};
  }
}

const scope = (sessionId = ADOPTED): SessionRuntimeScope => ({
  endpoint: "ws://server.test/ui",
  workspaceRoot: "/srv/project",
  profileId: "coding",
  sessionId,
  authorityEpoch: 1,
});

function harness(client = new PooledClient()) {
  let manager: SessionRecordManager<PooledClient>;
  manager = new SessionRecordManager<PooledClient>({
    pooledClient: () => client,
    authorityEpoch: () => 1,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    validateSessionCapabilities: (value) => {
      if (!value) throw new Error("missing capabilities");
    },
    controllerDependencies: (recordScope, recordClient) => ({
      client: () => recordClient() as never,
      sessionId: () => recordScope.sessionId,
      canEnqueue: () => true,
      canStart: () => true,
      canInterrupt: () => true,
      setTimeline: () => undefined,
      setConnectionError: () => undefined,
    }),
  });
  return { manager, client };
}

const adopt = (
  manager: SessionRecordManager<PooledClient>,
  over: Partial<{
    adoptedSessionId: string;
    adoptedTurnId: string;
    scope: SessionRuntimeScope;
  }> = {},
) =>
  manager.adoptOnRecord({
    adoptedSessionId: ADOPTED,
    adoptedTurnId: TURN,
    scope: scope(),
    ...over,
  });

describe("SessionRecordManager.adoptOnRecord (server-adopted peer identity)", () => {
  it("installs and readies the adopted Session that was never requested by session/open", async () => {
    const h = harness();
    const record = await adopt(h.manager);

    // The adopted id IS the installed identity — the staging-id assert is gone.
    expect(record.scope.sessionId).toBe(ADOPTED);
    expect(h.manager.get(scope())).toBe(record);
    expect(h.manager.records()).toHaveLength(1);
    expect(record.closed).toBe(false);
    expect(record.runtime.getSnapshot()).toMatchObject({
      phase: "ready",
      status: "connected",
    });
    expect(record.runtime.getSnapshot().session?.sessionId).toBe(ADOPTED);
    // The ONLY open issued names the ADOPTED id.
    expect(h.client.opens.map((params) => params.session_id)).toEqual([
      ADOPTED,
    ]);
    // The adopted turn — started by Core before this client opened the record —
    // is the record's LIVE turn, not a queue head the ready drain would resend.
    expect(record.controller.backgroundHandoffTurn()).toEqual({
      turnId: TURN,
      state: "running",
    });
    expect(record.controller.queueSnapshot().active).toBeNull();
  });

  it("is idempotent: the same adopted id twice resolves the SAME record without re-opening", async () => {
    const h = harness();
    const first = await adopt(h.manager);
    const second = await adopt(h.manager);

    expect(second).toBe(first);
    expect(h.manager.records()).toHaveLength(1);
    // No second session/open, no second hydrate.
    expect(h.client.opens).toHaveLength(1);
    expect(h.client.hydrates).toHaveLength(1);
  });

  it("refuses a scope that names another Session, installing nothing", async () => {
    const h = harness();
    await expect(adopt(h.manager, { scope: scope(FOREIGN) })).rejects.toThrow(
      /another Session/,
    );
    expect(h.manager.records()).toHaveLength(0);
    expect(h.client.opens).toHaveLength(0);
  });

  it("refuses an open that returns a different Session id, installing nothing", async () => {
    const h = harness();
    h.client.openedFor = () => ({
      session_id: FOREIGN,
      active_profile_id: "coding",
      workspace_root: "/srv/project",
      capabilities: caps,
    });
    await expect(adopt(h.manager)).rejects.toThrow(/another Session/);
    expect(h.manager.get(scope())).toBeNull();
    expect(h.manager.records()).toHaveLength(0);
  });
});

// Keep the record type referenced so the file fails loudly if the manager's
// exported record type stops carrying the controller seam this contract needs.
export type AdoptedRecord = SessionRecord<PooledClient>;
