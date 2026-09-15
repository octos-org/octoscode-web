import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LaunchDecisionPanel } from "./LaunchDecisionPanel.tsx";

describe("LaunchDecisionPanel", () => {
  it("keeps a failed candidate error visible beside the restored choice", () => {
    const html = renderToStaticMarkup(
      <LaunchDecisionPanel
        state={{
          phase: "awaiting_choice",
          cwd: "/srv/work/project",
          decision: {
            decision: "cross_profile",
            resolved_profile: "coding",
            existing_profiles: ["review"],
          },
        }}
        onboarding={{
          phase: "idle",
          supported: false,
          catalog: null,
          createdProfileId: null,
          error: null,
        }}
        error="The Session could not be hydrated."
        onSubmitOnboarding={vi.fn()}
        onRetryOnboarding={vi.fn()}
        onChooseProfile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("The Session could not be hydrated.");
    expect(html).toContain("Start coding here");
    expect(html).not.toContain("Activate coding");
  });
});
