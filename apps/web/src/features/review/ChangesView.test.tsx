import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChangesView } from "./ChangesView.tsx";
import type { DiffReviewRuntimeState } from "./use-coding-safety.ts";
import type { SessionFileChange } from "../side-panel/session-changes.ts";

const noGit: DiffReviewRuntimeState = {
  available: true,
  workspaceAvailable: false,
  active: true,
  scope: "turn",
  latestPreviewId: null,
  loading: false,
  result: null,
  error: null,
};

const change = (previewId: string | null): SessionFileChange => ({
  path: "sum.js",
  operation: "modify",
  previewId,
  bytesWritten: null,
});

function render(
  changes: readonly SessionFileChange[],
  state: DiffReviewRuntimeState = noGit,
) {
  return renderToStaticMarkup(
    <ChangesView
      state={state}
      changes={changes}
      onOpenPreview={vi.fn()}
      onRefresh={vi.fn()}
      onScopeChange={vi.fn()}
    />,
  );
}

describe("ChangesView without a preview or Git", () => {
  const SELECT = "Select a changed file above";

  it("points at a changed file only when one can be opened", () => {
    expect(render([])).not.toContain(SELECT);
    expect(render([change(null)])).not.toContain(SELECT);
    expect(
      render([change("preview-1")], { ...noGit, available: false }),
    ).not.toContain(SELECT);
    expect(render([change("preview-1")])).toContain(SELECT);
  });
});
