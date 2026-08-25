import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DiffReviewDialog } from "./DiffReviewDialog.tsx";

describe("DiffReviewDialog", () => {
  it("renders file, hunk, line numbers, totals, and inert content", () => {
    const html = renderToStaticMarkup(
      <DiffReviewDialog
        state={{
          available: true,
          latestPreviewId: "00000000-0000-4000-8000-000000000042",
          active: true,
          loading: false,
          error: null,
          result: {
            status: "ready",
            source: "pending_store",
            preview: {
              session_id: "s1",
              preview_id: "00000000-0000-4000-8000-000000000042",
              title: "Review <script>alert(1)</script>",
              files: [
                {
                  path: "src/lib.ts",
                  status: "modified",
                  hunks: [
                    {
                      header: "@@ -1 +1 @@",
                      lines: [
                        {
                          kind: "removed",
                          content: "const ready = false;",
                          old_line: 1,
                        },
                        {
                          kind: "added",
                          content: "const ready = true;",
                          new_line: 1,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          },
        }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    expect(html).toContain("src/lib.ts");
    expect(html).toContain("+1");
    expect(html).toContain("−1");
    expect(html).toContain("const ready = true;");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("keeps empty file previews honest", () => {
    const html = renderToStaticMarkup(
      <DiffReviewDialog
        state={{
          available: true,
          latestPreviewId: "00000000-0000-4000-8000-000000000042",
          active: true,
          loading: false,
          error: null,
          result: {
            status: "ready",
            source: "pending_store",
            preview: {
              session_id: "s1",
              preview_id: "00000000-0000-4000-8000-000000000042",
              files: [],
            },
          },
        }}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(html).toContain("contains no changed files");
  });
});
