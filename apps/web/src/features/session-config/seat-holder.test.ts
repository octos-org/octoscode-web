import { describe, expect, it } from "vitest";
import {
  seatHolderKind,
  SEAT_HOLDER_FOREIGN,
  SEAT_HOLDER_SELF,
  SEAT_HOLDER_NONE,
  stripSeatWords,
} from "./seat-holder.ts";

/**
 * Round 4 B (walkthrough 4200d/12.png): after THIS tab started a peer, the
 * strip/pane said "Another app is using this session" — but the holder is
 * this browser's own controller (§4.3/§5.2: a peer this app started is
 * WORKING in the session; only a FOREIGN holder gets the other-app words).
 */
describe("seat holder classification", () => {
  it("a binding under THIS app's stable driver id is SELF, never foreign", () => {
    expect(
      seatHolderKind({
        mode: "external",
        bindingDriverId: "octoscode-web:11111111-1111-4111-8111-111111111111",
        ownDriverId: "octoscode-web:11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(SEAT_HOLDER_SELF);
  });

  it("a binding under a DIFFERENT driver id is FOREIGN", () => {
    expect(
      seatHolderKind({
        mode: "external",
        bindingDriverId: "driver-b",
        ownDriverId: "octoscode-web:11111111-1111-4111-8111-111111111111",
      }),
    ).toBe(SEAT_HOLDER_FOREIGN);
  });

  it("internal mode with no binding is NONE", () => {
    expect(
      seatHolderKind({
        mode: "internal",
        bindingDriverId: null,
        ownDriverId: "octoscode-web:1",
      }),
    ).toBe(SEAT_HOLDER_NONE);
  });

  it("an external mode with a NULL binding is FOREIGN (parked, nobody local)", () => {
    expect(
      seatHolderKind({
        mode: "external",
        bindingDriverId: null,
        ownDriverId: "octoscode-web:1",
      }),
    ).toBe(SEAT_HOLDER_FOREIGN);
  });

  it("the strip words: self-hold is the peers-running fact, foreign keeps the design copy", () => {
    expect(stripSeatWords(SEAT_HOLDER_SELF)).not.toContain("Another app");
    expect(stripSeatWords(SEAT_HOLDER_SELF)).toBe("Peers running");
    expect(stripSeatWords(SEAT_HOLDER_FOREIGN)).toBe(
      "Another app is using this session",
    );
  });

  it("the NONE hold renders empty words (no false state)", () => {
    expect(stripSeatWords(SEAT_HOLDER_NONE)).toBe("");
  });
});
