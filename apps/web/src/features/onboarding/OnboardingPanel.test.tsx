import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OnboardingPanel } from "./OnboardingPanel.tsx";

describe("OnboardingPanel", () => {
  it("keeps credentials transient and offers server-advertised choices", () => {
    const html = renderToStaticMarkup(
      <OnboardingPanel
        state={{
          phase: "ready",
          supported: true,
          catalog: {
            families: [
              {
                id: "deepseek",
                env: "DEEPSEEK_API_KEY",
                models: [{ id: "deepseek-chat", endpoints: [] }],
              },
            ],
          },
          createdProfileId: null,
          error: null,
        }}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="new-password"');
    expect(html).toContain("never stored by this browser client");
    expect(html).toContain("deepseek");
  });

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
