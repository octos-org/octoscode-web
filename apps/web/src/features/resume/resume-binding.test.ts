import { describe, expect, it, vi } from "vitest";
import {
  OctosUiClient,
  type SessionHydrateResult,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { SessionRecordManager } from "../session/session-record-manager.ts";
import {
  createResumeBinding,
  isFullSessionForProfile,
  type ResumeCandidate,
} from "./resume-binding.ts";
const A = "coding:local:A",
  B = "coding:local:B";
const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    "session/list",
    "session/open",
    "session/hydrate",
    "turn/start",
  ],
  supported_notifications: [],
  supported_features: ["session.workspace_cwd.v1"],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function history(sessionId: string, nonempty = true): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: nonempty ? 1 : 0 },
    messages: nonempty
      ? [
          {
            seq: 1,
            role: "user",
            content: "original history",
            persisted_at: "2026-09-06T00:00:00Z",
            media: [],
          },
        ]
      : [],
    turns: [],
  };
}
async function fixture() {
  const client = new OctosUiClient({ endpoint: "ws://server.test/ui" });
  const pool = { client, epoch: 1, source: true };
  vi.spyOn(client, "status", "get").mockReturnValue("connected");
  vi.spyOn(client, "subscribeStatus").mockImplementation((fn) => {
    fn("connected");
    return () => undefined;
  });
  vi.spyOn(client, "subscribeErrors").mockReturnValue(() => undefined);
  vi.spyOn(client, "subscribeNotifications").mockReturnValue(() => undefined);
  vi.spyOn(client, "listConfigCapabilities").mockResolvedValue({
    capabilities: caps,
  });
  const openRpc = vi
    .spyOn(client, "openSession")
    .mockImplementation(async (params) => ({
      opened: {
        session_id: params.session_id,
        active_profile_id: params.profile_id ?? "coding",
        workspace_root: params.cwd ?? "/srv/project",
        capabilities: caps,
      },
    }));
  const hydrate = vi
    .spyOn(client, "hydrateSession")
    .mockImplementation(async (params) => history(params.session_id));
  const list = vi.spyOn(client, "listSessions").mockResolvedValue({
    sessions: [{ id: B, message_count: 1, title: "History" }],
  });
  const start = vi.spyOn(client, "startTurn").mockResolvedValue({});
  const manager = new SessionRecordManager({
    pooledClient: () => pool.client,
    authorityEpoch: () => pool.epoch,
    onSelectedEvent: () => undefined,
    onSelectedSnapshot: () => undefined,
    onBackgroundActivity: () => undefined,
    cursorFor: () => undefined,
    validateServerCapabilities: () => undefined,
    validateSessionCapabilities: () => undefined,
    controllerDependencies: (scope, owner) => ({
      client: owner,
      sessionId: () => scope.sessionId,
      canEnqueue: () => true,
      canStart: () => false,
      canInterrupt: () => false,
      setConnectionError: () => undefined,
    }),
  });
  const config = (id: string, cwd = "/srv/project") => ({
    endpoint: "ws://server.test/ui",
    token: "",
    sessionId: id,
    profileId: "coding",
    cwd,
  });
  const open = (id: string, cwd?: string) =>
    manager.openOnRecord(config(id, cwd), client, new AbortController().signal);
  const source = await open(A);
  manager.select(source.scope);
  const binding = createResumeBinding({
    manager,
    record: source,
    isSourceCurrent: () => pool.source,
  });
  const abort = new AbortController();
  const confirmation = (candidate: ResumeCandidate) => ({
    sessionId: candidate.id,
    workspaceRoot: "/srv/project",
    profileId: "coding",
  });
  return {
    client,
    pool,
    manager,
    source,
    binding,
    abort,
    confirmation,
    open,
    openRpc,
    list,
    hydrate,
    start,
  };
}
describe("historical identity boundaries", () => {
  it.each([
    "coding:local:A",
    "coding:matrix:!room:localhost#topic",
    "coding:wechat:chat#peer#nested",
  ])("recognizes actual full profile identity %s", (id) =>
    expect(isFullSessionForProfile(id, "coding")).toBe(true),
  );
  it.each([
    "bare",
    "local:A",
    "other:local:A",
    "api:local:A",
    "coding:future-channel:A",
    "coding:local:",
    "coding:local:A#",
    " coding:local:A",
    "coding:local:A\n",
  ])("never guesses identity for %s", (id) =>
    expect(isFullSessionForProfile(id, "coding")).toBe(false),
  );
  it("does not misread a channel-name profile as a full identity", () =>
    expect(isFullSessionForProfile("api:local:A", "api")).toBe(false));
});
describe("resume binding on the real persistent engine", () => {
  it("lists unverified candidates with cwd without creating or selecting records", async () => {
    const h = await fixture();
    const rows = await h.binding.list(h.abort.signal);
    expect(h.list).toHaveBeenCalledWith({ cwd: "/srv/project" });
    expect(rows[0]).toEqual({ id: B, messageCount: 1, title: "History" });
    expect(Object.isFrozen(rows[0])).toBe(true);
    expect(h.manager.records()).toEqual([h.source]);
    expect(h.manager.selected()).toBe(h.source);
    expect(h.start).not.toHaveBeenCalled();
  });
  it("requires exact confirmation and rejects forged or ambiguous bare rows without opening", async () => {
    const h = await fixture();
    h.list.mockResolvedValue({ sessions: [{ id: "bare", message_count: 2 }] });
    const [bare] = await h.binding.list(h.abort.signal);
    expect(h.binding.blockedReason(bare!)).toContain("authoritative full ID");
    await expect(
      h.binding.resume(bare!, h.confirmation(bare!), h.abort.signal),
    ).rejects.toThrow("authoritative full ID");
    h.list.mockResolvedValue({ sessions: [{ id: B, message_count: 1 }] });
    const [row] = await h.binding.list(h.abort.signal);
    await expect(
      h.binding.resume({ ...row! }, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("Refresh");
    await expect(
      h.binding.resume(
        row!,
        { ...h.confirmation(row!), workspaceRoot: "/wrong" },
        h.abort.signal,
      ),
    ).rejects.toThrow("Confirm");
    expect(h.openRpc).toHaveBeenCalledTimes(1);
  });
  it("opens a full identity in the background, verifies history, and never starts or selects", async () => {
    const h = await fixture();
    const [row] = await h.binding.list(h.abort.signal);
    const result = await h.binding.resume(
      row!,
      h.confirmation(row!),
      h.abort.signal,
    );
    expect(result.scope).toEqual({ ...h.source.scope, sessionId: B });
    expect(result.payload?.hydrated.messages?.[0]?.content).toBe(
      "original history",
    );
    expect(h.manager.selected()).toBe(h.source);
    expect(h.start).not.toHaveBeenCalled();
  });
  it("does not reinstall or reset an existing record's queue when inspecting it for resume", async () => {
    const h = await fixture();
    const retained = await h.open(B);
    retained.queue.enqueue({ turnId: "active", text: "active" });
    retained.queue.enqueue({ turnId: "pending", text: "pending" });
    const [row] = await h.binding.list(h.abort.signal);
    const before = h.openRpc.mock.calls.length;
    expect(
      await h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).toBe(retained);
    expect(h.openRpc).toHaveBeenCalledTimes(before);
    expect(retained.queue.snapshot().pending[0]?.turnId).toBe("pending");
  });
  it("allows a bare ID only when that exact record was previously confirmed in this scope", async () => {
    const h = await fixture();
    const retained = await h.open("bare");
    h.list.mockResolvedValue({ sessions: [{ id: "bare", message_count: 1 }] });
    const [row] = await h.binding.list(h.abort.signal);
    expect(h.binding.blockedReason(row!)).toBeNull();
    expect(
      await h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).toBe(retained);
  });
  it("blocks a pooled same-ID workspace collision before open", async () => {
    const h = await fixture();
    await h.open(B, "/other/project");
    const [row] = await h.binding.list(h.abort.signal);
    await expect(
      h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("another workspace");
    expect(h.openRpc).toHaveBeenCalledTimes(2);
  });
  it("never launches another preparation over a retained record that is still opening", async () => {
    const h = await fixture();
    const pending = h.manager.ensure({ ...h.source.scope, sessionId: B });
    const [row] = await h.binding.list(h.abort.signal);
    expect(h.binding.blockedReason(row!)).toContain("still opening");
    await expect(
      h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("still opening");
    expect(h.openRpc).toHaveBeenCalledTimes(1);
    expect(h.manager.get(pending.scope)).toBe(pending);
    expect(h.manager.selected()).toBe(h.source);
  });
  it("empty hydrate of advertised history fails and evicts only its new idle placeholder", async () => {
    const h = await fixture();
    const [row] = await h.binding.list(h.abort.signal);
    h.hydrate.mockImplementation(async (params) =>
      history(params.session_id, false),
    );
    await expect(
      h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("not resolved");
    expect(h.manager.records()).toEqual([h.source]);
    expect(h.manager.selected()).toBe(h.source);
  });
  it("never evicts a pre-existing empty record when history cannot be resolved", async () => {
    const h = await fixture();
    h.hydrate.mockImplementation(async (params) =>
      history(params.session_id, false),
    );
    const prior = await h.open(B);
    const [row] = await h.binding.list(h.abort.signal);
    await expect(
      h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("not resolved");
    expect(h.manager.get(prior.scope)).toBe(prior);
  });
  it("rejects double submit and a selection switch while delayed hydrate is pending", async () => {
    const h = await fixture();
    const other = await h.open("coding:local:other");
    const [row] = await h.binding.list(h.abort.signal);
    const gate = deferred<SessionHydrateResult>();
    h.hydrate.mockReturnValue(gate.promise);
    const pending = h.binding.resume(
      row!,
      h.confirmation(row!),
      h.abort.signal,
    );
    await expect(
      h.binding.resume(row!, h.confirmation(row!), h.abort.signal),
    ).rejects.toThrow("already pending");
    h.manager.select(other.scope);
    gate.resolve(history(B));
    await expect(pending).rejects.toThrow("authority changed");
    expect(h.manager.selected()).toBe(other);
    expect(
      h.manager.records().map((record) => record.scope.sessionId),
    ).not.toContain(B);
  });
  it("source invalidation during list cannot republish catalog candidates", async () => {
    const h = await fixture();
    const gate = deferred<{ sessions: [] }>();
    h.list.mockReturnValue(gate.promise);
    const pending = h.binding.list(h.abort.signal);
    h.pool.source = false;
    gate.resolve({ sessions: [] });
    await expect(pending).rejects.toThrow("authority changed");
    expect(h.manager.records()).toEqual([h.source]);
  });
  it("abort before commit leaves the source untouched and never claims a historical resume", async () => {
    const h = await fixture();
    const [row] = await h.binding.list(h.abort.signal);
    const gate = deferred<SessionHydrateResult>();
    h.hydrate.mockReturnValue(gate.promise);
    const pending = h.binding.resume(
      row!,
      h.confirmation(row!),
      h.abort.signal,
    );
    h.abort.abort();
    gate.resolve(history(B));
    await expect(pending).rejects.toThrow();
    expect(h.manager.records()).toEqual([h.source]);
  });
  it("rejects ambiguous duplicate catalog IDs and superseded row objects", async () => {
    const h = await fixture();
    const [old] = await h.binding.list(h.abort.signal);
    h.list.mockResolvedValue({
      sessions: [
        { id: B, message_count: 1 },
        { id: B, message_count: 2 },
      ],
    });
    await expect(h.binding.list(h.abort.signal)).rejects.toThrow("duplicate");
    expect(h.binding.blockedReason(old!)).toContain("Refresh");
  });
});
