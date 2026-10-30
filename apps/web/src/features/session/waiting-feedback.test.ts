import { describe, expect, it } from "vitest";
import { waitingFeedback } from "./waiting-feedback.ts";

describe("waiting feedback", () => {
  it("stays quiet before the threshold", () => {
    expect(
      waitingFeedback({
        activityLabel: "Working…",
        turnStarting: false,
        elapsedMs: 14_999,
      }),
    ).toBeNull();
  });

  it("distinguishes server acceptance from the model's first response", () => {
    expect(
      waitingFeedback({
        activityLabel: "Working…",
        turnStarting: true,
        elapsedMs: 15_000,
      }),
    ).toEqual({
      phase: "Waiting for the server to accept this turn",
      elapsedSeconds: 15,
    });
    expect(
      waitingFeedback({
        activityLabel: "Working…",
        turnStarting: false,
        elapsedMs: 105_000,
      }),
    ).toEqual({
      phase: "Waiting for the model’s first response",
      elapsedSeconds: 105,
    });
  });

  it("keeps an established tool or writing phase", () => {
    expect(
      waitingFeedback({
        activityLabel: "Running read_file…",
        turnStarting: false,
        elapsedMs: 20_000,
      })?.phase,
    ).toBe("Running read_file…");
    expect(
      waitingFeedback({
        activityLabel: "Writing response…",
        turnStarting: false,
        elapsedMs: 20_000,
      })?.phase,
    ).toBe("Writing response…");
  });
});
