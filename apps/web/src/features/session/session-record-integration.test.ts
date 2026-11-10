import { describe, expect, it } from "vitest";
import {
  CORE_UI_METHODS,
  type SessionHydrateResult,
} from "@octos-org/octoscode-client";
import {
  deferred,
  enqueue,
  envelope,
  flush,
  harness,
  hydrate,
  open,
  rows,
  starts,
  terminal,
} from "./session-record-test-fixture.ts";

// Real SessionRecordManager + controller + runtime on one pooled client
// (ADR 0020, ADR 0005). Guarded chains: hydrate/live identity reconciliation
// (no lost or doubled prose across rehydrate), eviction/close publication,
// history-lease atomicity and fencing, caller-UUID admission and twin
// folding, background FIFO drain, loss freeze without ambiguous replay, and
// recovery superseded by epoch/client/evict/abort or a scope mismatch.
describe("SessionRecordManager real record/controller/runtime integration", () => {
  it("admits caller UUID once and folds optimistic, canonical echo, and legacy twins exactly once", async () => {
    const h = harness({ presentation: true });
    const a = await open(h, "A");
    h.manager.select(a.scope);
    enqueue(a, "A1");
    expect(a.controller.enqueueTurn({ turnId: "A1", text: "duplicate" })).toBe(
      false,
    );
    h.client.emit(envelope("A", "A1", 1, "user_message", { text: "A1" }));
    const delta = envelope("A", "A1", 2, "assistant_delta", { text: "hello" });
    h.client.emit(delta);
    h.client.emit(delta);
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.MESSAGE_DELTA,
      params: { session_id: "A", turn_id: "A1", text: "hello" },
    });
    h.client.emit(terminal("A", "A1", 3));
    h.client.emit({
      jsonrpc: "2.0",
      method: CORE_UI_METHODS.TURN_COMPLETED,
      params: { session_id: "A", turn_id: "A1" },
    });
    await flush();
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["assistant:A1:default", "hello"],
      ["terminal:A1", ""],
    ]);
    expect(h.view.timeline).toEqual(a.timeline);
  });

  it("freezes all records on loss, ignores old RPC rejection, and resumes A2 only after ready then A3 after A2 terminal", async () => {
    const h = harness({ presentation: true });
    const a = await open(h, "A");
    h.manager.select(a.scope);
    const oldRpc = deferred<unknown>();
    h.client.startGate = ({ turn_id }) =>
      turn_id === "A1" ? oldRpc.promise : Promise.resolve({});
    enqueue(a, "A1");
    enqueue(a, "A2");
    enqueue(a, "A3");
    const b = await open(h, "B");
    h.manager.select(b.scope);
    h.client.setStatus("disconnected");
    expect(a.runtime.currentAuthority()).toBeNull();
    expect(b.runtime.currentAuthority()).toBeNull();
    oldRpc.reject(new Error("old socket lost"));
    await flush();
    expect(a.queue.snapshot()).toEqual({
      active: { turnId: "A1", text: "A1" },
      pending: [
        { turnId: "A2", text: "A2" },
        { turnId: "A3", text: "A3" },
      ],
    });
    const recovery = deferred<SessionHydrateResult>();
    h.client.hydratedFor = (id) =>
      id === "A" ? recovery.promise : hydrate(id);
    h.client.setStatus("connected");
    const recovered = h.manager.recoverRecords(new AbortController().signal);
    await flush();
    expect(starts(h.client)).toEqual([["A", "A1"]]);
    expect(b.runtime.currentAuthority()).toBeNull();
    recovery.resolve(
      hydrate("A", {
        cursor: { stream: "A", seq: 9 },
        turns: [{ turn_id: "A1", state: "interrupted" }],
        messages: [
          {
            seq: 1,
            role: "user",
            content: "A1",
            turn_id: "A1",
            persisted_at: "",
            media: [],
          },
        ],
      }),
    );
    expect((await recovered).map((result) => result.state)).toEqual([
      "rehydrated",
      "rehydrated",
    ]);
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["A", "A2"],
    ]);
    // Upstream v0.10.0 renders the hydrated interrupted A1 as a stopped row.
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["terminal:A1", "This turn was stopped before it completed."],
      ["user:A2", "A2"],
    ]);
    h.client.emit(terminal("A", "A2", 10));
    await flush();
    expect(starts(h.client)).toEqual([
      ["A", "A1"],
      ["A", "A2"],
      ["A", "A3"],
    ]);
    expect(rows(a)).toEqual([
      ["user:A1", "A1"],
      ["terminal:A1", "This turn was stopped before it completed."],
      ["user:A2", "A2"],
      ["terminal:A2", ""],
      ["user:A3", "A3"],
    ]);
    expect(h.view.timeline).toEqual(b.timeline);
    expect(b.timeline).toEqual([]);
    expect(h.client.opens.at(-2)?.after).toEqual({ stream: "A", seq: 1 });
  });
});
