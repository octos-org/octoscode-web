import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ResumeDialog } from "./ResumeDialog.tsx";
import type { ResumeBinding } from "./resume-binding.ts";

describe("historical resume presentation", () => {
  it("labels unverified scope and treats an initial query as text, not automatic selection", () => {
    const resume = vi.fn();
    const onResumed = vi.fn();
    const binding: ResumeBinding = {
      authorityKey: "captured",
      scope: {
        endpoint: "ws://server.test/ui",
        workspaceRoot: "/srv/project",
        profileId: "coding",
        sessionId: "coding:local:A",
        authorityEpoch: 1,
      },
      isCurrent: () => true,
      subscribe: () => () => undefined,
      list: vi.fn().mockResolvedValue([]),
      blockedReason: () => null,
      resume,
    };
    const html = renderToStaticMarkup(
      <ResumeDialog
        binding={binding}
        initialQuery={"<script>history</script>"}
        onClose={() => undefined}
        onResumed={onResumed}
      />,
    );
    expect(html).toContain("unverified candidates");
    expect(html).toContain("legacy global list");
    expect(html).toContain("/srv/project");
    expect(html).toContain("&lt;script&gt;history&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("Verify history and resume");
    expect(resume).not.toHaveBeenCalled();
    expect(onResumed).not.toHaveBeenCalled();
  });
});
