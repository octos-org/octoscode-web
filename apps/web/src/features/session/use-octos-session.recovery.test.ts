import { describe, expect, it } from "vitest";
import type { SessionRecordRecoveryResult } from "./session-record-manager.ts";
import { planRecoverySurfacing } from "./use-octos-session.ts";

/**
 * A pooled-transport reconnect recovers EVERY managed record. When some records
 * fail but the SELECTED record recovered, the live Session must not be torn
 * down: the active record stays selected, its composer stays available, and the
 * failure surfaces as a NON-FATAL, dismissible alert listing the failed
 * Sessions. Only a failure of the SELECTED record may be fatal.
 */
describe("partial session recovery surfacing", () => {
  const rehydrated = (sessionId: string): SessionRecordRecoveryResult => ({
    sessionId,
    state: "rehydrated",
  });
  const failed = (sessionId: string): SessionRecordRecoveryResult => ({
    sessionId,
    state: "failed",
    error: `boom:${sessionId}`,
  });

  it("keeps the live Session and raises a non-fatal notice when only other records failed", () => {
    const surfacing = planRecoverySurfacing(
      [rehydrated("selected"), failed("other-a"), failed("other-b")],
      "selected",
    );

    // NOT fatal: the active record stays selected, so the composer surface
    // (rendered only while that record is the live Session) remains available.
    expect(surfacing.fatal).toBeNull();
    // Non-fatal, dismissible alert naming the failed Sessions.
    expect(surfacing.notice).not.toBeNull();
    expect(surfacing.notice?.failedSessionIds).toEqual(["other-a", "other-b"]);
    expect(surfacing.notice?.message).toContain("2 Session(s)");
    expect(surfacing.notice?.message).toContain("not been replayed");
  });

  it("is silent when every managed record recovered", () => {
    const surfacing = planRecoverySurfacing(
      [rehydrated("selected"), rehydrated("other-a")],
      "selected",
    );
    expect(surfacing.fatal).toBeNull();
    expect(surfacing.notice).toBeNull();
  });

  it("is fatal only when the SELECTED record itself failed", () => {
    const surfacing = planRecoverySurfacing(
      [failed("selected"), rehydrated("other-a")],
      "selected",
    );
    expect(surfacing.fatal).not.toBeNull();
    expect(surfacing.fatal).toContain("1 Session(s)");
    // The fatal path already owns the whole workspace; no duplicate notice.
    expect(surfacing.notice).toBeNull();
  });

  it("treats every failure as non-fatal when no record is selected yet", () => {
    const surfacing = planRecoverySurfacing(
      [failed("other-a"), failed("other-b")],
      null,
    );
    expect(surfacing.fatal).toBeNull();
    expect(surfacing.notice?.failedSessionIds).toEqual(["other-a", "other-b"]);
  });
});