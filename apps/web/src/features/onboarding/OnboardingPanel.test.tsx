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
  it("labels the provider, model and advanced identity controls", () => {
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
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="provider"');
    expect(html).toContain('name="model"');
    expect(html).toContain('name="profile-id"');
    expect(html).toContain('name="profile-name"');
    expect(html).toContain("Use as the default local profile");
  });
});
