import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  SessionInteractionLedger,
  StaleInteractionGenerationError,
  type SessionInteractionClient,
} from "./session-interaction-ledger.ts";

const endpoint = "ws://server.test/ui";
const cfg = { endpoint, sessionId: "s1" };

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    CORE_UI_METHODS.APPROVAL_RESPOND,
    CORE_UI_METHODS.USER_QUESTION_RESPOND,
  ],
  supported_notifications: [],
  supported_features: [CORE_UI_FEATURES.USER_QUESTION_V1],
};
const approval = {
  session_id: "s1",
  turn_id: "t1",
  approval_id: "ap1",
  tool_name: "shell",
  title: "Run?",
  body: "pnpm test",
  typed_details: { command: "pnpm test" },
};
const question = {
  session_id: "s1",
  turn_id: "t1",
  question_id: "q1",
  title: "Choose",
  body: "Two choices",
  questions: [
    {
      header: "First",
      question: "One?",
      options: [{ label: "Yes", description: "Continue" }],
    },
    { header: "Second", question: "Two?", options: [], allow_free_text: true },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function parsedLedger() {
  const { client, calls } = fakeClient();
  const authority = {
    generation: 1,
    client,
    sessionId: "s1",
    capabilities,
    ready: true,
  };
  const ledger = new SessionInteractionLedger({
    authorityFor: () => authority,
  });
  const restore = (pending: {
    pending_approvals?: unknown[];
    pending_questions?: unknown[];
  }) =>
    ledger.restoreFromHydrate(cfg, authority.generation, pending, {
      background: true,
    });
  return { ledger, authority, calls, restore };
}

interface Call {
  method: string;
  params: Record<string, unknown>;
}

function fakeClient() {
  const calls: Call[] = [];
  const client: SessionInteractionClient = {
    respondApproval: async (params) => {
      calls.push({ method: "approval/respond", params: { ...params } });
      return { approval_id: params.approval_id, accepted: true };
    },
    respondUserQuestion: async (params) => {
      calls.push({ method: "user_question/respond", params: { ...params } });
      return { question_id: params.question_id, accepted: true };
    },
  };
  return { client, calls };
}

describe("SessionInteractionLedger", () => {
  it.each(["approval", "question"] as const)(
    "responds to split-wire %s with the confirmed full topic owner, rejecting foreign and stale requests",
    async (kind) => {
      const h = parsedLedger();
      const method =
        kind === "approval"
          ? CORE_UI_METHODS.APPROVAL_REQUESTED
          : CORE_UI_METHODS.USER_QUESTION_REQUESTED;
      const wire = kind === "approval" ? approval : question;
      // Same base/turn/request IDs do not authorize a foreign topic on an ordinary owner.
      expect(
        h.ledger.observeNotification(
          cfg,
          1,
          {
            jsonrpc: "2.0",
            method,
            params: { ...wire, topic: "peer-review" },
          },
          { background: true },
        ),
      ).toBe(false);
      expect(h.ledger.current(cfg)).toBeNull();

      const owner = { ...cfg, sessionId: "s1#peer-review" };
      h.authority.sessionId = owner.sessionId;
      const observe = (topic: string) =>
        h.ledger.observeNotification(
          owner,
          h.authority.generation,
          {
            jsonrpc: "2.0",
            method,
            params: { ...wire, topic },
          },
          { background: true },
        );
      expect(observe("peer-review")).toBe(true);
      const stale = h.ledger.current(owner)!;
      expect(observe("peer-foreign")).toBe(false);
      expect(h.ledger.current(owner)).toBe(stale);
      const resolution =
        kind === "approval"
          ? { decision: "approve" as const }
          : {
              answers: [
                { selected_labels: ["Yes"] },
                { free_text: "second answer" },
              ],
            };
      h.authority.generation += 1;
      expect(observe("peer-review")).toBe(true);
      await expect(h.ledger.resolve(stale, resolution)).rejects.toBeInstanceOf(
        StaleInteractionGenerationError,
      );
      expect(h.calls).toEqual([]);
      await h.ledger.resolve(h.ledger.current(owner)!, resolution);
      expect(h.calls).toEqual([
        {
          method:
            kind === "approval" ? "approval/respond" : "user_question/respond",
          params: {
            session_id: owner.sessionId,
            ...(kind === "approval"
              ? { approval_id: "ap1", decision: "approve" }
              : { question_id: "q1", answers: resolution.answers }),
          },
        },
      ]);
      expect(h.ledger.current(owner)).toBeNull();
    },
  );
  it("restores full parsed approval and question payloads with one cached snapshot and exact Waiting records", () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval], pending_questions: [question] });
    const snapshot = h.ledger.getSnapshot();
    expect(h.ledger.getSnapshot()).toBe(snapshot);
    expect(snapshot.approval).toMatchObject({
      approvalId: "ap1",
      body: "pnpm test",
      typedDetails: { command: "pnpm test" },
    });
    expect(snapshot.question?.questions).toHaveLength(2);
    expect(
      h.ledger
        .waitingSnapshot()
        .map((record) => [record.kind, record.requestId, record.generation]),
    ).toEqual([
      ["approval", "ap1", 1],
      ["question", "q1", 1],
    ]);
    h.restore({ pending_questions: [question] });
    expect(h.ledger.getSnapshot().approval).toBeNull();
    expect(h.ledger.waitingSnapshot()).toHaveLength(1);
  });

  it("rejects malformed, foreign-topic and unnegotiated hydrate requests", () => {
    const h = parsedLedger();
    h.restore({
      pending_approvals: [
        { approval_id: "incomplete", turn_id: "t1" },
        { ...approval, session_id: "other" },
      ],
    });
    expect(h.ledger.getSnapshot().approval).toBeNull();
    h.ledger.restoreFromHydrate(
      { endpoint, sessionId: "s1#peer-a" },
      1,
      { pending_approvals: [{ ...approval, topic: "peer-b" }] },
      { background: false },
    );
    expect(h.ledger.waitingSnapshot()).toEqual([]);
    h.authority.capabilities = { ...capabilities, supported_methods: [] };
    h.restore({ pending_approvals: [approval], pending_questions: [question] });
    expect(h.ledger.waitingSnapshot()).toEqual([]);
  });

  it("sends all question answers and client note once while busy", async () => {
    const h = parsedLedger();
    h.restore({ pending_questions: [question] });
    const rpc = deferred<unknown>();
    const respond = vi.fn(() => rpc.promise);
    h.authority.client.respondUserQuestion = respond;
    const answers = [
      { selected_labels: ["Yes"] },
      { free_text: "second answer" },
    ];
    const result = h.ledger.respondQuestion(answers, "my note");
    answers[0]!.selected_labels![0] = "mutated";
    expect(h.ledger.getSnapshot().busy).toBe(true);
    await h.ledger.respondQuestion([{ free_text: "duplicate" }]);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(respond).toHaveBeenCalledWith({
      session_id: "s1",
      question_id: "q1",
      answers: [{ selected_labels: ["Yes"] }, { free_text: "second answer" }],
      client_note: "my note",
    });
    rpc.resolve({ question_id: "q1", accepted: true });
    await result;
    expect(h.ledger.getSnapshot()).toEqual({
      approval: null,
      question: null,
      busy: false,
      error: null,
    });
  });

  it.each([false, "wrong-id"])(
    "retains the pending request when a response is %s",
    async (result) => {
      const h = parsedLedger();
      h.restore({ pending_approvals: [approval] });
      h.authority.client.respondApproval = async () => ({
        accepted: result !== false,
        approval_id: result === "wrong-id" ? "other" : "ap1",
      });
      await h.ledger.respondApproval("approve", "request");
      expect(h.ledger.getSnapshot().approval?.approvalId).toBe("ap1");
      expect(h.ledger.getSnapshot().error).not.toBeNull();
      expect(h.ledger.getSnapshot().busy).toBe(false);
    },
  );

  it("does not clear a rehydrated same-ID request when the retired generation's response resolves", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    const stale = h.ledger.current(cfg)!;
    const rpc = deferred<unknown>();
    h.authority.client.respondApproval = () => rpc.promise;
    const responding = h.ledger.respondApproval("approve");
    h.authority.generation += 1;
    h.restore({ pending_approvals: [approval] });
    rpc.resolve({ accepted: true, approval_id: "ap1" });
    await responding;
    expect(h.ledger.current(cfg)?.generation).toBe(2);
    expect(h.ledger.getSnapshot()).toMatchObject({
      busy: false,
      error: null,
      approval: { approvalId: "ap1" },
    });
    await expect(
      h.ledger.resolve(stale, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
  });

  it("rejects resolution during recovery and ignores foreign or wrong-turn resolution notifications", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    h.authority.ready = false;
    await h.ledger.respondApproval("approve");
    expect(h.calls).toEqual([]);
    expect(h.ledger.current(cfg)).not.toBeNull();
    h.authority.ready = true;
    for (const params of [
      { session_id: "other", turn_id: "t1" },
      { session_id: "s1", turn_id: "other" },
    ]) {
      expect(
        h.ledger.observeNotification(
          cfg,
          1,
          {
            jsonrpc: "2.0",
            method: CORE_UI_METHODS.APPROVAL_DECIDED,
            params: { ...params, approval_id: "ap1" },
          },
          { background: false },
        ),
      ).toBe(false);
    }
    expect(
      h.ledger.observeNotification(
        cfg,
        1,
        {
          jsonrpc: "2.0",
          method: CORE_UI_METHODS.APPROVAL_DECIDED,
          params: { session_id: "s1", turn_id: "t1", approval_id: "ap1" },
        },
        { background: false },
      ),
    ).toBe(true);
    expect(h.ledger.current(cfg)).toBeNull();
  });

  it("ignores duplicate replay and marking read while its exact response remains in flight", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    const rpc = deferred<unknown>();
    h.authority.client.respondApproval = () => rpc.promise;
    const response = h.ledger.respondApproval("approve");
    h.ledger.observeNotification(
      cfg,
      1,
      {
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_REQUESTED,
        params: approval,
      },
      { background: true },
    );
    h.ledger.markRead(cfg);
    expect(h.ledger.getSnapshot().busy).toBe(true);
    rpc.resolve({ accepted: true, approval_id: "ap1" });
    await response;
    expect(h.ledger.current(cfg)).toBeNull();
  });

  it("observes a foreground interaction as read", () => {
    const { client } = fakeClient();
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation: 7, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 7,
        turnId: "t1",
        requestId: "ap-1",
        title: "Run tests?",
      },
      { background: false },
    );
    const record = ledger.current(cfg);
    expect(record?.unread).toBe(false);
    expect(record?.kind).toBe("approval");
  });

  it("marks a background-observed interaction unread (Waiting badge)", () => {
    const { client } = fakeClient();
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation: 1, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "question",
        generation: 1,
        turnId: "t1",
        requestId: "q-1",
        title: "Pick",
      },
      { background: true },
    );
    expect(ledger.current(cfg)?.unread).toBe(true);
    expect(ledger.waitingSnapshot()).toHaveLength(1);
    ledger.markRead(cfg);
    expect(ledger.current(cfg)?.unread).toBe(false);
  });

  it("resolve writes an approval decision to the SAME generation that observed it", async () => {
    const { client, calls } = fakeClient();
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation: 3, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 3,
        turnId: "t1",
        requestId: "ap-9",
        title: "Allow?",
      },
      { background: true },
    );
    const record = ledger.current(cfg)!;
    await ledger.resolve(record, {
      decision: "approve",
      approvalScope: "turn",
    });
    expect(calls).toEqual([
      {
        method: "approval/respond",
        params: {
          session_id: "s1",
          approval_id: "ap-9",
          decision: "approve",
          approval_scope: "turn",
        },
      },
    ]);
    expect(ledger.current(cfg)).toBeNull();
  });

  it("resolve fails closed when the Session reconnected since observation", async () => {
    const { client, calls } = fakeClient();
    let generation = 5;
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 5,
        turnId: "t1",
        requestId: "ap-5",
        title: "Allow?",
      },
      { background: false },
    );
    const record = ledger.current(cfg)!;
    generation = 6; // socket replaced
    await expect(
      ledger.resolve(record, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
    expect(calls).toHaveLength(0); // never write into a stale socket
  });

  it("resolve fails closed when the Session is no longer live", async () => {
    const ledger = new SessionInteractionLedger({ authorityFor: () => null });
    ledger.observe(
      cfg,
      {
        kind: "question",
        generation: 1,
        turnId: "t1",
        requestId: "q-7",
        title: "?",
      },
      { background: false },
    );
    await expect(
      ledger.resolve(ledger.current(cfg)!, { answer: { free_text: "x" } }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
  });

  it("settleTurn drops the record for that turn only", () => {
    const { client } = fakeClient();
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation: 1, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 1,
        turnId: "t1",
        requestId: "ap-1",
        title: "A",
      },
      { background: false },
    );
    ledger.observe(
      { endpoint, sessionId: "s2" },
      {
        kind: "approval",
        generation: 1,
        turnId: "t2",
        requestId: "ap-2",
        title: "B",
      },
      { background: true },
    );
    ledger.settleTurn(cfg, "t1");
    expect(ledger.current(cfg)).toBeNull();
    expect(ledger.current({ endpoint, sessionId: "s2" })).not.toBeNull();
  });

  it("publishes to subscribers on observe/settle/resolve", async () => {
    const { client } = fakeClient();
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation: 1, client, sessionId: "s1" }),
    });
    const listener = vi.fn();
    ledger.subscribe(listener);
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 1,
        turnId: "t1",
        requestId: "ap-1",
        title: "A",
      },
      { background: false },
    );
    ledger.settleTurn(cfg, "t1");
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("refuses a late response superseded by a newer interaction without dispatching", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    const superseded = h.ledger.current(cfg)!;
    expect(superseded.requestId).toBe("ap1");
    // A newer interaction for the same Session arrives on the same generation.
    h.ledger.observeNotification(
      cfg,
      1,
      {
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_REQUESTED,
        params: { ...approval, approval_id: "ap2", turn_id: "t2" },
      },
      { background: true },
    );
    const current = h.ledger.current(cfg)!;
    expect(current.requestId).toBe("ap2");
    await expect(
      h.ledger.resolve(superseded, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
    expect(h.calls).toEqual([]);
    await h.ledger.resolve(current, { decision: "approve" });
    expect(h.calls).toEqual([
      {
        method: "approval/respond",
        params: { session_id: "s1", approval_id: "ap2", decision: "approve" },
      },
    ]);
  });

  it("refuses a response after the session switched away and back, then dispatches the re-armed record once", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    const before = h.ledger.current(cfg)!;
    h.authority.generation += 1; // switched away: transport generation advanced
    await expect(
      h.ledger.resolve(before, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
    expect(h.calls).toEqual([]);
    h.restore({ pending_approvals: [approval] }); // switched back: rehydrated
    const rearmed = h.ledger.current(cfg)!;
    expect(rearmed.generation).toBe(2);
    await h.ledger.resolve(rearmed, { decision: "approve" });
    expect(h.calls).toHaveLength(1);
  });

  it("refuses a response once the owning session has closed", async () => {
    const h = parsedLedger();
    h.restore({ pending_approvals: [approval] });
    const record = h.ledger.current(cfg)!;
    h.authority.ready = false; // owning session closed its transport
    await expect(
      h.ledger.resolve(record, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
    expect(h.calls).toEqual([]);
  });

  it("keeps a non-selected session's pending interaction visible and unread", () => {
    const h = parsedLedger();
    const other = { endpoint, sessionId: "s2" };
    h.ledger.observeNotification(
      other,
      1,
      {
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_REQUESTED,
        params: { ...approval, session_id: "s2" },
      },
      { background: true },
    );
    h.ledger.observeNotification(
      cfg,
      1,
      {
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_REQUESTED,
        params: approval,
      },
      { background: true },
    );
    h.ledger.markRead(cfg); // selecting s1 must not read s2
    expect(h.ledger.current(other)?.unread).toBe(true);
    expect(h.ledger.waitingSnapshot()).toHaveLength(2);
    h.ledger.markRead(other);
    expect(h.ledger.current(other)?.unread).toBe(false);
  });
});
