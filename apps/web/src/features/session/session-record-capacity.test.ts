import { describe, expect, it } from "vitest";
import type { SessionRecord } from "./session-record-manager.ts";
import {
  enqueue,
  envelope,
  flush,
  harness,
  open,
  PooledClient,
  startsFor,
} from "./session-record-test-fixture.ts";

/**
 * Drive the REAL manager/runtime with 12 Session records + 3 peer records on
 * ONE pooled transport, each with a three-turn FIFO, scripted selection and
 * out-of-order completion. Only the transport is a double.
 */
const IDS = [
  "S00",
  "S01",
  "S02",
  "S03",
  "S04",
  "S05",
  "S06",
  "S07",
  "S08",
  "S09",
  "S10",
  "S11",
  "peer-0",
  "peer-1",
  "peer-2",
] as const;
const TURNS = ["t1", "t2", "t3"] as const;

/** Complete ONE turn of a record, then wait for its next FIFO turn to start. */
async function complete(
  client: PooledClient,
  sessionId: string,
  turnId: string,
  seq: number,
  next: string | null,
) {
  const entered = next
    ? new Promise<void>((resolve) => {
        // Observer registered BEFORE the terminal that advances the queue.
        client.startEntered.push(() => resolve());
      })
    : null;
  client.emit(
    envelope(sessionId, turnId, seq + 1, "turn_terminal", {
      outcome: "completed",
    }),
  );
  // The terminal must settle exactly this turn and start its own next FIFO head.
  if (entered) await entered;
  await flush();
  if (next) expect(startsFor(client, sessionId)).toContain(next);
}

describe("SessionRecordManager capacity: 12 Sessions + 3 peers on one transport", () => {
  it("keeps 15 live records' FIFOs isolated under scripted selection and out-of-order completion", async () => {
    PooledClient.constructed = 0;
    const h = harness();
    const records = new Map<string, SessionRecord<PooledClient>>();
    for (const id of IDS) records.set(id, await open(h, id));

    // ONE transport for all 15 records (no per-record socket).
    expect(PooledClient.constructed).toBe(1);
    expect(h.manager.records()).toHaveLength(IDS.length);

    // Each record owns its own FIFO: three turns, enqueued in order.
    for (const id of IDS)
      for (const turn of TURNS) enqueue(records.get(id)!, `${id}-${turn}`);
    await flush();
    // Exactly one active start per record, and each is that record's FIRST turn.
    expect(h.client.starts).toHaveLength(IDS.length);
    for (const id of IDS) expect(startsFor(h.client, id)).toEqual([`${id}-t1`]);

    // Scripted selection across every record while work is live.
    const order = [7, 0, 11, 3, 14, 5, 1, 9, 2, 12, 6, 4, 13, 8, 10];
    for (const index of order)
      h.manager.select(records.get(IDS[index]!)!.scope);
    // Selection never reset a queue nor re-dispatched a start.
    expect(h.client.starts).toHaveLength(IDS.length);
    expect(h.manager.selected()!.scope.sessionId).toBe(IDS[order.at(-1)!]);

    // Out-of-order completion: drain t1 of every record in a shuffled order,
    // then t2, then t3 — each record advances ONLY its own FIFO.
    const drains = [
      [5, 13, 1, 9, 0, 14, 3, 11, 7, 2, 12, 6, 4, 10, 8],
      [14, 2, 8, 0, 6, 12, 4, 10, 1, 7, 13, 3, 9, 5, 11],
      [9, 4, 14, 7, 1, 11, 5, 13, 0, 8, 2, 12, 6, 10, 3],
    ];
    let seq = 1;
    for (let depth = 0; depth < TURNS.length; depth += 1) {
      for (const index of drains[depth]!) {
        const id = IDS[index]!;
        const turn = TURNS[depth]!;
        const next = TURNS[depth + 1] ? `${id}-${TURNS[depth + 1]}` : null;
        await complete(h.client, id, `${id}-${turn}`, seq, next);
        seq += 2;
      }
    }
    await flush();

    // Every queue drained in its OWN order; no foreign turn ever started.
    expect(h.client.starts).toHaveLength(IDS.length * TURNS.length);
    for (const id of IDS)
      expect(startsFor(h.client, id)).toEqual([
        `${id}-t1`,
        `${id}-t2`,
        `${id}-t3`,
      ]);
    for (const id of IDS) {
      const snapshot = records.get(id)!.controller.snapshot();
      expect(snapshot.active).toBeNull();
      expect(snapshot.pending).toEqual([]);
    }

    // Background completions marked unread WITHOUT stealing selection.
    const pinned = h.manager.selected()!.scope.sessionId;
    for (const id of IDS)
      if (id !== pinned) expect(records.get(id)!.unread).toBe(true);
    expect(records.get(pinned)!.unread).toBe(false);
    expect(h.manager.selected()!.scope.sessionId).toBe(pinned);
  });
});
