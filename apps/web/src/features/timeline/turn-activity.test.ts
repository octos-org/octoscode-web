import { describe, expect, it } from "vitest";
import {
  activityGlyph,
  activityLabel,
  initialActivityState,
  turnActivity,
} from "./turn-activity.ts";

describe("turn activity state machine", () => {
  it("starts idle with no label and no glyph", () => {
    const state = initialActivityState();
    expect(state).toEqual(null);
    expect(activityLabel(state)).toBe("");
    expect(activityGlyph(state)).toBe("");
  });

  it("says Thinking… while only reasoning has streamed", () => {
    let state = initialActivityState();
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 1_000 });
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 2_000 });
    expect(activityLabel(state)).toBe("Thinking…");
    expect(activityGlyph(state)).toBe("spinner");
  });

  it("switches to the tool's verb the moment a tool call starts", () => {
    let state = initialActivityState();
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 1_000 });
    state = turnActivity(state, {
      kind: "tool-start",
      atMs: 2_000,
      toolName: "shell",
    });
    expect(activityLabel(state)).toBe("Running shell…");
    expect(activityGlyph(state)).toBe("spinner");
  });

  it("returns to Thinking… after a tool completes and no answer streamed yet", () => {
    let state = initialActivityState();
    state = turnActivity(state, {
      kind: "tool-start",
      atMs: 1_000,
      toolName: "shell",
    });
    state = turnActivity(state, { kind: "tool-end", atMs: 2_500 });
    expect(activityLabel(state)).toBe("Thinking…");
  });

  it("says Writing… once assistant text begins streaming", () => {
    let state = initialActivityState();
    state = turnActivity(state, {
      kind: "tool-start",
      atMs: 1_000,
      toolName: "shell",
    });
    state = turnActivity(state, { kind: "tool-end", atMs: 2_000 });
    state = turnActivity(state, { kind: "assistant-delta", atMs: 3_000 });
    expect(activityLabel(state)).toBe("Writing…");
  });

  it("a later tool call preempts the Writing… label", () => {
    let state = initialActivityState();
    state = turnActivity(state, { kind: "assistant-delta", atMs: 1_000 });
    state = turnActivity(state, {
      kind: "tool-start",
      atMs: 2_000,
      toolName: "write_file",
    });
    expect(activityLabel(state)).toBe("Running write_file…");
  });

  it("disappears on turn end", () => {
    let state = initialActivityState();
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 1_000 });
    state = turnActivity(state, { kind: "turn-end", atMs: 9_000 });
    expect(state).toEqual(null);
  });

  it("carries the running elapsed window for the transcript bottom line", () => {
    let state = initialActivityState();
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 1_000 });
    state = turnActivity(state, { kind: "reasoning-delta", atMs: 8_400 });
    expect(state).toEqual({
      label: "Thinking…",
      startedAtMs: 1_000,
      lastAtMs: 8_400,
    });
  });

  it("treats unknown tool names as generic Running…", () => {
    let state = initialActivityState();
    state = turnActivity(state, {
      kind: "tool-start",
      atMs: 1_000,
      toolName: "mystery",
    });
    expect(activityLabel(state)).toBe("Running mystery…");
  });
});
