import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Round 3 item 6 (judge #4, actions-06b H1-H6): dock + Fleet rows act through
 * REAL pending ids; Answer opens the real question card; sidebar threads the
 * dock's onRowAction seam.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const sidebar = readFileSync(
  new URL("../features/shell/ProductSidebar.tsx", import.meta.url),
  "utf8",
);

describe("dock rows act through App (H3)", () => {
  it("sidebar threads onPeerDockRowAction into the dock", () => {
    expect(sidebar).toContain("onPeerDockRowAction");
    expect(sidebar).toMatch(/onRowAction=\{onPeerDockRowAction\}/);
  });

  it("App wires the dock seam to the held-seat sink", () => {
    expect(app).toContain("onPeerDockRowAction={");
    expect(app).toContain("sendProductRowAction");
  });
});

describe("Fleet rows bind REAL pending ids (H4)", () => {
  it("builds the command from the row's attention facts, not the console overload", () => {
    expect(app).toMatch(/peerRowAttention\(/);
    expect(app).toMatch(
      /buildRowControlCommand\(\s*action,\s*steerText \?\? "",\s*peerRowAttention\(entry\),/,
    );
  });

  it("Answer opens the real question card instead of a frame (H4/H5)", () => {
    expect(app).toContain("peerAnswerRequest(");
    expect(app).toContain("setPeerAnswerRow(entry)");
  });
});

describe("the row-opened Answer card mounts the REAL request (H5)", () => {
  it("uses the row's stamped request with toControlAnswers submit", () => {
    expect(app).toContain("peerAnswerWireRequest(peerAnswerRow)");
    expect(app).toContain("toControlAnswers(");
    expect(app).toMatch(/free_text \?\? ""/);
  });

  it("holds the pending row in state and clears it on resolve (H2/H6)", () => {
    expect(app).toContain("peerAnswerRow");
    expect(app).toMatch(/setPeerAnswerRow\(null\)/);
  });
});
