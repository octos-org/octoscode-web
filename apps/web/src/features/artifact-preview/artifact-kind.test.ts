import { describe, expect, it } from "vitest";
import { artifactKind, artifactReadsBlob } from "./artifact-kind.ts";

describe("artifact preview type detection", () => {
  it.each([
    ["report.PDF", "pdf"],
    ["report.docx", "docx"],
    ["budget.xlsx", "spreadsheet"],
    ["budget.csv", "spreadsheet"],
    ["deck.pptx", "unsupported"],
    ["diagram.svg", "svg"],
    ["photo.webp", "image"],
    ["index.html", "html"],
    ["README.md", "markdown"],
    ["script.TS", "code"],
    ["output.log", "text"],
    ["archive.zip", "unsupported"],
  ])("maps %s to %s", (name, kind) => {
    expect(artifactKind(name)).toBe(kind);
  });

  it("uses binary reads only for viewers that need complete bytes", () => {
    expect(artifactReadsBlob("/work/deck.pptx")).toBe(true);
    expect(artifactReadsBlob("/work/page.html")).toBe(true);
    expect(artifactReadsBlob("/work/README.md")).toBe(false);
    expect(artifactReadsBlob("/work/output.txt")).toBe(false);
  });
});
