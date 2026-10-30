import { describe, expect, it } from "vitest";
import { structuredWritePath, writtenArtifactPath } from "./artifact-tools.ts";

describe("written artifact paths", () => {
  it("accepts only explicit write/edit path arguments", () => {
    expect(writtenArtifactPath("write_file", '{"path":"report.md"}')).toBe(
      "report.md",
    );
    expect(
      writtenArtifactPath("edit_file", '{"file_path":"/work/report.md"}'),
    ).toBe("/work/report.md");
    expect(
      writtenArtifactPath("write_file", '{"path":"C:\\\\repo\\\\report.md"}'),
    ).toBe("C:/repo/report.md");
    expect(
      writtenArtifactPath("edit_file", '{"path":"reports\\\\report.md"}'),
    ).toBe("reports/report.md");
    expect(writtenArtifactPath("read_file", '{"path":"report.md"}')).toBe("");
    expect(writtenArtifactPath("write_file", '{"filePath":"report.md"}')).toBe(
      "report.md",
    );
    expect(
      writtenArtifactPath(
        "write_file",
        '{"path":"report.md","content":"# truncated before the end',
      ),
    ).toBe("report.md");
    expect(
      writtenArtifactPath(
        "write_file",
        'path: "report.md", content: "# 第 43 周销售周报\\n"',
      ),
    ).toBe("report.md");
    expect(writtenArtifactPath("write_file", "not json")).toBe("");
    expect(writtenArtifactPath("write_file", '{"content":"report.md"}')).toBe(
      "",
    );
  });

  it("accepts only a safe structured replay write path", () => {
    expect(structuredWritePath("write_file", "reports/report.md")).toBe(
      "reports/report.md",
    );
    expect(structuredWritePath("edit_file", "C:\\repo\\report.md")).toBe(
      "C:/repo/report.md",
    );
    expect(structuredWritePath("read_file", "report.md")).toBe("");
    for (const value of [undefined, null, "", "../secret", 0, {}, ["x"]]) {
      expect(structuredWritePath("write_file", value)).toBe("");
    }
  });
});
