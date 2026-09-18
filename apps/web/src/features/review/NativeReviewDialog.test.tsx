import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NativeReviewDialog } from "./NativeReviewDialog.tsx";
import type { NativeReviewBinding } from "./native-review.ts";

function binding(blocked: string | null = null): NativeReviewBinding {
  return {
    scope: {
      endpoint: "ws://server.test/ui",
      authorityEpoch: 1,
      sessionId: "coding:local:A",
      workspaceRoot: "/srv/project",
      profileId: "coding",
    },
    authorityKey: "full-scope-1",
    isCurrent: () => true,
    subscribe: () => () => undefined,
    blockedReason: () => blocked,
    start: vi.fn(() => "review-uuid"),
  };
}
describe("NativeReviewDialog", () => {
  it("clearly distinguishes a native workflow from a diff preview and renders instructions inertly", () => {
    const owner = binding();
    const html = renderToStaticMarkup(
      <NativeReviewDialog
        binding={owner}
        initialPrompt="<script>danger</script>"
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Native code review");
    expect(html).toContain("not a diff preview");
    expect(html).toContain("Start native review");
    expect(html).toContain("&lt;script&gt;danger&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(owner.start).not.toHaveBeenCalled();
  });
  it("shows an authoritative block and disables starting", () => {
    const html = renderToStaticMarkup(
      <NativeReviewDialog
        binding={binding("Wait for queued prompts.")}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Wait for queued prompts.");
    expect(html).toContain('disabled="">Start native review');
  });
});
