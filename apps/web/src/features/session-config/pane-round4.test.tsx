import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelSection } from "./model-section.tsx";
import { SessionConfigPane } from "./SessionConfigPane.tsx";

const modelControl = {
  state: { status: "ready" as const },
  groups: [],
  selected: null,
  locked: false,
  labels: {
    menu: "Model",
    loading: "Loading models…",
    unavailable: "Model unavailable",
    select: "Select model",
    empty: "No models",
    retry: "Retry",
  },
  onSelect: () => {},
};

const pane = (props: Partial<Parameters<typeof SessionConfigPane>[0]>) =>
  renderToStaticMarkup(
    <SessionConfigPane
      open
      onClose={() => {}}
      model={modelControl}
      savedProfileModel="glm-5.3"
      permission={null}
      sandbox={{ supported: true, summary: null }}
      advanced={{ present: false }}
      {...props}
    />,
  );

const css = readFileSync(
  new URL("./SessionConfig.module.css", import.meta.url),
  "utf8",
);

describe("Section D — pane styling (CSS module)", () => {
  it("styles the pane's native buttons with the app's button recipe", () => {
    expect(css).toMatch(
      /\.session-config-button\s*\{[^}]*--dsw-alias-button-elevated-fill/s,
    );
    expect(css).toMatch(/\.session-config-button\s*\{[^}]*border-radius:\s*12px/s);
  });

  it("lays out label+control rows on the 8px grid", () => {
    expect(css).toMatch(
      /\.session-config-row\s*\{[^}]*display:\s*(?:grid|flex)/s,
    );
    expect(css).toMatch(/\.session-config-row\s*\{[^}]*gap:\s*8px/s);
  });

  it("aligns the Show thinking switch with its label in one row", () => {
    expect(css).toMatch(
      /\.session-config-switch\s*\{[^}]*display:\s*(?:grid|flex)[^}]*align-items:\s*center/s,
    );
  });

  it("gives headings a consistent rhythm (section spacing)", () => {
    expect(css).toMatch(/\.session-config-section h3\s*\{[^}]*margin/s);
  });
});

describe("Section D — markup hooks for the styled pane", () => {
  it("Close and Resume chat carry the button class", () => {
    const html = pane({
      holderBanner: { foreignSeatHeld: true, onResumeChat: () => {} },
    });
    expect(html).toMatch(/<button[^>]*class="[^"]*session-config-button/);
  });

  it("Show thinking renders as a switch row bound to its label", () => {
    const html = pane({
      showThinking: true,
      onShowThinkingChange: () => {},
    });
    expect(html).toMatch(
      /class="[^"]*session-config-switch[^"]*"[^>]*>\s*<input[^>]*type="checkbox"/s,
    );
  });

  it("Saved-for-this-profile row has a space between label and value", () => {
    const html = pane({});
    expect(html).not.toMatch(/for this profile:<strong/);
  });
});

describe("Section D — spec 1188: session runtime vs profile default", () => {
  it("shows the session runtime model and the profile default as distinct labelled values once each", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={modelControl}
        savedProfileModel="DeepSeek V4 Pro"
        runtimeModel="DeepSeek V4"
        t={(s) => s}
      />,
    );
    expect(html).toContain("Session runtime");
    expect(html).toContain("Saved for this profile:");
    expect(html.match(/DeepSeek V4(?! Pro|")/g)?.length).toBe(1);
    expect(html.match(/DeepSeek V4 Pro/g)?.length).toBe(1);
  });

  it("hides the runtime row while no turn runs and no stamp is known", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={modelControl}
        savedProfileModel="DeepSeek V4 Pro"
        t={(s) => s}
      />,
    );
    expect(html).not.toContain("Session runtime");
  });
});

describe("Section B (pane copy) — own hold vs foreign holder", () => {
  it("renders the foreign-holder banner with Resume chat", () => {
    const html = pane({
      holderBanner: {
        foreignSeatHeld: true,
        onResumeChat: () => {},
      },
    });
    expect(html).toContain("Another app is using this session");
    expect(html).toContain("Resume chat");
  });

  it("renders the own-hold words WITHOUT Resume chat or foreign copy", () => {
    const html = pane({
      holderBanner: {
        foreignSeatHeld: false,
        ownSeatHeld: true,
      },
    });
    expect(html).not.toContain("Another app is using this session");
    expect(html).not.toContain("Resume chat");
    expect(html).toContain("A peer you started is using this session");
  });

  it("renders no banner when nobody holds", () => {
    const html = pane({ holderBanner: null });
    expect(html).not.toContain("Another app is using this session");
    expect(html).not.toContain("A peer you started is using this session");
  });
});
