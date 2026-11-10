import { describe, expect, it } from "vitest";
import { CORE_UI_METHODS } from "@octos-org/octoscode-client";
import {
  approvalRequested,
  boundedWait,
  config,
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

/**
 * Three retained records on ONE pooled client: a real approval blocks A while
 * B/C drain; selection, foreign decisions and genuinely stale frames stay
 * isolated. Queue/ledger/controller/folding logic is the REAL manager stack.
 */
describe("SessionRecordManager three-record concurrency", () => {
  it("A blocked on a REAL approval while B/C drain exactly once; second starts gated on OBSERVED entry; selection switches never reset; foreign interrupt/decision and genuinely-stale cursor events stay isolated", async () => {
    const h = harness();
    try {
      const a = await open(h, "A");
      const b = await open(h, "B");
      const c = await open(h, "C");
      enqueue(a, "A1");
      enqueue(a, "A2");
      enqueue(b, "B1");
      enqueue(b, "B2");
      enqueue(c, "C1");
      enqueue(c, "C2");
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
      ]);
      // A's active turn hits a REAL approval; only A's ledger is waiting.
      h.client.emit(approvalRequested("A", "A1", "ap-A1"));
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-A1");
      expect(b.interactions.getSnapshot().approval).toBeNull();
      expect(c.interactions.getSnapshot().approval).toBeNull();
      // Repeated selection switches while A is blocked.
      for (const record of [b, c, a, c, b, a, b]) {
        h.manager.select(record.scope);
      }
      expect(b.selected).toBe(true);
      expect(a.selected).toBe(false);
      // B: finish B1; the B2 start OBSERVER is registered BEFORE the event
      // that advances the queue (B1's terminal).
      h.client.emit(envelope("B", "B1", 1, "assistant_delta", { text: "b1" }));
      const b2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("B", "B1", 2));
      await b2Entered;
      expect(starts(h.client)).toContainEqual(["B", "B2"]);
      // FOREIGN-to-A interrupt: interrupting B's active turn records ONE
      // interrupt referencing B/B2 and never touches A's queue.
      await b.controller.interrupt();
      expect(h.client.interrupts.length).toBe(1);
      expect(JSON.stringify(h.client.interrupts[0])).toContain("B");
      expect(JSON.stringify(h.client.interrupts[0])).toContain("B2");
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      h.client.emit(terminal("B", "B2", 3));
      // C likewise: observer before C1's terminal, then C2's own terminal.
      h.client.emit(envelope("C", "C1", 1, "assistant_delta", { text: "c1" }));
      const c2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("C", "C1", 2));
      await c2Entered;
      expect(starts(h.client)).toContainEqual(["C", "C2"]);
      h.client.emit(terminal("C", "C2", 3));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
        ["B", "B2"],
        ["C", "C2"],
      ]);
      // A's second turn NEVER started while blocked.
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      // FOREIGN resolution: B-scoped decision for A's approval id must NOT
      // clear A's pending interaction.
      h.client.emit({
        jsonrpc: "2.0",
        method: CORE_UI_METHODS.APPROVAL_DECIDED,
        params: {
          session_id: "B",
          approval_id: "ap-A1",
          decision: "approve",
        },
      });
      await flush();
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-A1");
      // GENUINELY stale: fold a live delta (seq 10 → cursor 11), then
      // re-emit seq 10 — its cursor (11) is not past the stored one, so it
      // must be dropped (no duplicate row).
      h.client.emit(envelope("A", "A1", 10, "assistant_delta", { text: "a1" }));
      await flush();
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
      ]);
      h.client.emit(
        envelope("A", "A1", 10, "assistant_delta", { text: "dup" }),
      );
      await flush();
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
      ]);
      // Resolve A's OWN approval; A1 completes; A2 starts exactly once
      // (observer before A1's terminal).
      await a.interactions.respondApproval("approve", "turn");
      expect(h.client.responses).toEqual([
        {
          session_id: "A",
          approval_id: "ap-A1",
          decision: "approve",
          approval_scope: "turn",
        },
      ]);
      const a2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("A", "A1", 11));
      await a2Entered;
      h.client.emit(terminal("A", "A2", 12));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["B", "B1"],
        ["C", "C1"],
        ["B", "B2"],
        ["C", "C2"],
        ["A", "A2"],
      ]);
      // Exact OWNING timelines; no cross-session contamination.
      expect(rows(a)).toEqual([
        ["user:A1", "A1"],
        ["assistant:A1:default", "a1"],
        ["terminal:A1", ""],
        ["user:A2", "A2"],
        ["terminal:A2", ""],
      ]);
      expect(rows(b)).toEqual([
        ["user:B1", "B1"],
        ["assistant:B1:default", "b1"],
        ["terminal:B1", ""],
        ["user:B2", "B2"],
        ["terminal:B2", ""],
      ]);
      expect(rows(c)).toEqual([
        ["user:C1", "C1"],
        ["assistant:C1:default", "c1"],
        ["terminal:C1", ""],
        ["user:C2", "C2"],
        ["terminal:C2", ""],
      ]);
      expect(h.client.status).toBe("connected");
    } finally {
      h.manager.suspendRecords();
    }
  });

  it("RECONNECT with a pending interaction: canonical hydrate restores the blocked approval; enqueue stays blocked until resolution", async () => {
    const h = harness();
    try {
      const a = await open(h, "A");
      enqueue(a, "A1");
      h.client.emit(approvalRequested("A", "A1", "ap-re"));
      expect(a.interactions.getSnapshot().approval?.body).toBe("body-ap-re");
      h.manager.suspendRecords();
      // The REOPEN hydrate carries the pending approval + an active turn.
      h.client.hydratedFor = (id) =>
        hydrate(id, {
          cursor: { stream: id, seq: 5 },
          turns: [{ turn_id: "A1", thread_id: "A1", state: "active" }],
          pending_approvals: [
            {
              session_id: "A",
              turn_id: "A1",
              approval_id: "ap-re",
              tool_name: "shell",
              title: "Run?",
              body: "body-ap-re",
              typed_details: { command: "cmd-ap-re" },
            },
          ],
        });
      const reopened = await h.manager.openOnRecord(
        config("A"),
        h.pool.client,
        new AbortController().signal,
      );
      expect(reopened).toBe(a);
      await flush();
      expect(reopened.interactions.getSnapshot().approval?.body).toBe(
        "body-ap-re",
      );
      // Queue ADMISSION may stay allowed while the interaction blocks; the
      // proof is NO start/drain until the owner terminal event.
      expect(
        reopened.controller.enqueueTurn({ turnId: "A2", text: "A2" }),
      ).toBe(true);
      await flush();
      expect(starts(h.client).filter(([s]) => s === "A")).toEqual([
        ["A", "A1"],
      ]);
      await reopened.interactions.respondApproval("approve", "turn");
      expect(h.client.responses).toEqual([
        {
          session_id: "A",
          approval_id: "ap-re",
          decision: "approve",
          approval_scope: "turn",
        },
      ]);
      const a2Entered = new Promise<void>((resolve) => {
        h.client.startEntered.push(() => resolve());
      });
      h.client.emit(terminal("A", "A1", 6));
      await boundedWait("reconnect A2 start", a2Entered);
      h.client.emit(terminal("A", "A2", 7));
      await flush();
      expect(starts(h.client)).toEqual([
        ["A", "A1"],
        ["A", "A2"],
      ]);
      expect(h.client.status).toBe("connected");
    } finally {
      h.manager.suspendRecords();
    }
  });
});
