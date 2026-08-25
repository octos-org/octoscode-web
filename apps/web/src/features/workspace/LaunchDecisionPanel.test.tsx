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
        onChooseProfile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("Start deepseek here");
    expect(html).toContain("Continue with glm");
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
        onChooseProfile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain("octoscode onboard");
  });
});
