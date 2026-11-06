import { describe, expect, it } from "vitest";
import {
  dropImportRun,
  importRun,
  importRunView,
  publishImportRun,
  startImportRun,
  type ImportRun,
} from "./import-runs.ts";

const run = (scope: string, name = "a.json"): ImportRun => ({
  scope,
  name,
  batches: [],
  outcome: {
    total: 1,
    sent: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    confirmed: 0,
  },
  pending: false,
});

describe("import runs", () => {
  it("shows a scope only its own run, as a copy", () => {
    const mine = run("profile\u0000session-a");
    startImportRun(mine);
    expect(importRunView("profile\u0000session-a")?.name).toBe("a.json");
    expect(importRunView("profile\u0000session-b")).toBeNull();
    mine.outcome.sent = 1;
    mine.outcome.stop = { batch: 1, size: 1, kind: "uncertain", reason: "x" };
    publishImportRun(mine);
    const view = importRunView("profile\u0000session-a");
    expect(view?.outcome.sent).toBe(1);
    expect(view?.outcome.stop).toEqual(mine.outcome.stop);
    expect(view?.outcome.stop).not.toBe(mine.outcome.stop);
    expect(importRunView("profile\u0000session-b")).toBeNull();
  });
  it("ignores a run a newer one replaced, and never drops a pending run", () => {
    const scope = "profile\u0000replace";
    const older = run(scope, "old.json");
    const newer = run(scope, "new.json");
    startImportRun(older);
    startImportRun(newer);
    older.outcome.sent = 1;
    publishImportRun(older);
    expect(importRunView(scope)).toMatchObject({
      name: "new.json",
      outcome: { sent: 0 },
    });
    newer.pending = true;
    dropImportRun(scope);
    expect(importRun(scope)).toBe(newer);
    newer.pending = false;
    dropImportRun(scope);
    expect(importRun(scope)).toBeUndefined();
    expect(importRunView(scope)).toBeNull();
  });
});
