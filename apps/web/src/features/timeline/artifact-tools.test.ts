import { describe, expect, it } from "vitest";
import { writtenArtifactPath } from "./artifact-tools.ts";

describe("written artifact paths", () => {
  it("accepts only explicit write/edit path arguments", () => {
    expect(writtenArtifactPath("write_file", '{"path":"report.md"}')).toBe(
      "report.md",
    );
    expect(
      writtenArtifactPath("edit_file", '{"file_path":"/work/report.md"}'),
    ).toBe("/work/report.md");
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
});
