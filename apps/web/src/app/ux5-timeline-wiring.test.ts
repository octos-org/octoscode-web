import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * UX5 (transcript-04b) App wiring: fold state + turn-activity state, the
 * Timeline/strip props, the timeline→activity effect, the pane's show-thinking
 * row, and the judge-r1 copy check. Source-level assertions (App.tsx reads
 * `window` at module scope).
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const timeline = readFileSync(
  new URL("../features/timeline/Timeline.tsx", import.meta.url),
  "utf8",
);

describe("UX5 App wiring (transcript-04b gap hunks)", () => {
  it("holds fold + turn-activity state and imports the pure machines", () => {
    expect(app).toContain("initialFoldState");
    expect(app).toContain("initialActivityState");
    expect(app).toMatch(
      /from "\.\.\/features\/timeline\/folds\.ts"/,
    );
    expect(app).toMatch(/from "\.\.\/features\/timeline\/turn-activity\.ts"/);
  });

  it("threads folds + handlers + activity into <Timeline>", () => {
    expect(app).toMatch(/showThinking=\{conversation\.showReasoning\}/);
    expect(app).toMatch(/folds=\{timelineFolds\}/);
    expect(app).toMatch(/onToggleFold=\{/);
    expect(app).toMatch(/onExpandAll=\{/);
    expect(app).toMatch(/onCollapseAll=\{/);
    expect(app).toMatch(/activity=\{turnActivityState\}/);
  });

  it("derives turn activity from the timeline's last entry", () => {
    expect(app).toContain("turn-end");
    expect(app).toContain("reasoning-delta");
    expect(app).toContain("tool-start");
    expect(app).toContain("assistant-delta");
    // The pure machine is driven through the functional state update.
    expect(app).toMatch(/setTurnActivityState\(\s*\(current\) => turnActivity\(/);
  });

  it("passes activity to the status strip", () => {
    const stripMount = app.indexOf("<SessionStatusStrip");
    const mountEnd = app.indexOf("onOpenPane", stripMount);
    const region = app.slice(stripMount, mountEnd);
    expect(region).toMatch(/activity=\{turnActivityState\}/);
  });

  it("wires the pane's show-thinking row to the preference store", () => {
    expect(app).toMatch(/showThinking=\{conversation\.showReasoning\}/);
    expect(app).toMatch(/onShowThinkingChange=\{/);
    expect(app).toContain("writeShowThinking");
  });

  it("judge r1: empty state no longer says 'durable projection events'", () => {
    expect(timeline).not.toContain("durable projection events");
  });
});
