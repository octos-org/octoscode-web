import { describe, expect, it } from "vitest";
import { DurableSessionProjection } from "./durable-session.ts";

function envelope(
  seq: number,
  cursorSeq: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    jsonrpc: "2.0" as const,
    method: "projection/envelope",
    params: {
      session_id: "coding:local:main",
      thread_id: "thread-1",
      seq,
      cursor: { stream: "coding:local:main", seq: cursorSeq },
      turn_id: "turn-1",
      payload: { type: "assistant_delta", data: { text: "hello" } },
      ...overrides,
    },
  };
}

describe("DurableSessionProjection", () => {
  it("accepts monotonic envelopes and rejects a replayed duplicate", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");

    expect(projection.observe(envelope(4, 10)).kind).toBe("apply");
    expect(projection.observe(envelope(4, 10))).toMatchObject({
      kind: "ignore",
      reason: "duplicate",
    });
    expect(projection.observe(envelope(5, 11)).kind).toBe("apply");
    expect(projection.snapshot()).toMatchObject({
      phase: "healthy",
      cursor: { seq: 11 },
    });
  });

  it("fails closed on a per-thread sequence gap", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");
    projection.observe(envelope(1, 7));

    expect(projection.observe(envelope(3, 9))).toMatchObject({
      kind: "recover",
      reason: expect.stringContaining("expected 2"),
    });
    expect(projection.snapshot().phase).toBe("gap");
  });

  it("ignores recovery-buffered envelopes already covered by the hydrate cursor", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");
    projection.observe(envelope(1, 7));

    projection.commitHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 12 },
    });

    // commitHydrate clears the per-thread window (hydrate lanes are
    // partial), so envelopes at or below the hydrate cursor — already
    // contained in the hydrated transcript — must be dropped as stale
    // instead of being replayed as new.
    expect(
      projection.observe(envelope(2, 11), { fromRecoveryBuffer: true }),
    ).toMatchObject({
      kind: "ignore",
      reason: "stale",
    });
    // Live envelopes (not from the recovery buffer) keep the old semantics:
    // the transcript does not authoritatively cover undelivered deltas.
    expect(projection.observe(envelope(2, 11)).kind).toBe("apply");
    expect(projection.observe(envelope(3, 13)).kind).toBe("apply");
  });

  it("rejects cross-session and cross-topic contamination", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main#review");

    expect(
      projection.observe(
        envelope(1, 1, {
          session_id: "coding:local:main",
          topic: "coding",
        }),
      ),
    ).toMatchObject({ kind: "ignore", reason: "wrong_session" });
    expect(
      projection.observe(
        envelope(1, 1, {
          session_id: "coding:local:main",
          topic: "review",
        }),
      ).kind,
    ).toBe("apply");
  });

  it("turns replay_lossy into an explicit recovery request", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");

    expect(
      projection.observe({
        jsonrpc: "2.0",
        method: "protocol/replay_lossy",
        params: { session_id: "coding:local:main", dropped_count: 3 },
      }),
    ).toMatchObject({ kind: "recover" });
    expect(projection.snapshot()).toMatchObject({
      phase: "lossy",
      detail: expect.stringContaining("3 durable events"),
    });
  });

  it("resets sequence assumptions after authoritative hydrate", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");
    projection.observe(envelope(7, 12));
    projection.beginHydrate();
    projection.commitHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 20 },
    });

    expect(projection.observe(envelope(42, 21)).kind).toBe("apply");
  });

  it("does not seed live ordering from hydrate's partial replay lanes", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");
    projection.commitHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 20 },
      replayed_tool_envelopes: [
        {
          session_id: "coding:local:main",
          thread_id: "thread-1",
          seq: 4,
          cursor: { stream: "coding:local:main", seq: 19 },
          turn_id: "turn-1",
          payload: { type: "tool_start", data: {} },
        },
      ],
    });

    expect(projection.observe(envelope(2, 18)).kind).toBe("apply");
    expect(projection.observe(envelope(3, 19)).kind).toBe("apply");
  });

  it("keeps the failure cause visible across reconnect attempts", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");

    projection.fail(
      "Recovery buffer exceeded 4096 events; reconnecting from the last durable cursor",
    );
    projection.beginReconnect(1);
    expect(projection.snapshot()).toMatchObject({
      phase: "reconnecting",
      detail:
        "Connection lost · retry 1 · Recovery buffer exceeded 4096 events; reconnecting from the last durable cursor",
    });

    // Later attempts keep the cause instead of folding it into the banner.
    projection.beginReconnect(2);
    expect(projection.snapshot().detail).toBe(
      "Connection lost · retry 2 · Recovery buffer exceeded 4096 events; reconnecting from the last durable cursor",
    );
  });

  it("drops the failure cause once recovery is healthy again", () => {
    const projection = new DurableSessionProjection();
    projection.reset("coding:local:main");

    projection.fail("boom");
    projection.commitHydrate({
      session_id: "coding:local:main",
      cursor: { stream: "coding:local:main", seq: 12 },
    });
    projection.beginReconnect(1);
    expect(projection.snapshot().detail).toBe("Connection lost · retry 1");
  });
});
