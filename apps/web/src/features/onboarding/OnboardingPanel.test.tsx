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
  it("associates provider, model and route selects with labels", () => {
    const html = renderToStaticMarkup(
      <OnboardingPanel
        state={{
          phase: "ready",
          supported: true,
          createdProfileId: null,
          error: null,
          catalog: {
            families: [
              {
                id: "openai",
                env: "OPENAI_API_KEY",
                models: [
                  {
                    id: "dummy",
                    endpoints: [{ id: "official", label: "Official API" }],
                  },
                ],
              },
            ],
          },
        }}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('for="onboarding-provider"');
    expect(html).toContain('for="onboarding-model"');
    expect(html).toContain('for="onboarding-route"');
    expect(html).toContain('id="onboarding-provider"');
    expect(html).toContain('id="onboarding-model"');
    expect(html).toContain('id="onboarding-route"');
  });
});
