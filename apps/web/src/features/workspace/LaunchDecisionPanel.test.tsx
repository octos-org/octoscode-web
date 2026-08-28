import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LaunchDecisionPanel } from "./LaunchDecisionPanel.tsx";

describe("LaunchDecisionPanel", () => {
  it("preserves Octoscode cross-profile choices", () => {
    const html = renderToStaticMarkup(
      <LaunchDecisionPanel
        state={{
          phase: "awaiting_choice",
          cwd: "/srv/work/project",
          decision: {
            decision: "cross_profile",
            resolved_profile: "deepseek",
            existing_profiles: ["glm"],
          },
        }}
        onboarding={{
          phase: "idle",
          supported: false,
          catalog: null,
          createdProfileId: null,
          error: null,
        }}
        onSubmitOnboarding={vi.fn()}
        onRetryOnboarding={vi.fn()}
        onChooseProfile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("Start deepseek here");
    expect(html).toContain("Start new session with glm");
    expect(html).not.toContain("Resume");
    expect(html).toContain("/srv/work/project");
  });

  it("routes a server with no profile to canonical onboarding", () => {
    const html = renderToStaticMarkup(
      <LaunchDecisionPanel
        state={{
          phase: "awaiting_choice",
          cwd: "/srv/work/project",
          decision: { decision: "no_profile", existing_profiles: [] },
        }}
        onboarding={{
          phase: "idle",
          supported: false,
          catalog: null,
          createdProfileId: null,
          error: null,
        }}
        onSubmitOnboarding={vi.fn()}
        onRetryOnboarding={vi.fn()}
        onChooseProfile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("octoscode onboard");
  });

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
