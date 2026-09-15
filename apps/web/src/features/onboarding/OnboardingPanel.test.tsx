import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OnboardingPanel } from "./OnboardingPanel.tsx";

describe("OnboardingPanel", () => {
  it("retains the canonical TUI fallback when Core lacks Web onboarding", () => {
    const html = renderToStaticMarkup(
      <OnboardingPanel
        state={{
          phase: "idle",
          supported: false,
          catalog: null,
          createdProfileId: null,
          error: null,
        }}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("octoscode onboard");
  });
});
