import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModelSection } from "./model-section.tsx";

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

/** Interpolates {value0} like the real catalogs do. */
const t = (source: string, params?: Record<string, string | number>) =>
  params
    ? source.replace(/\{([^{}]+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : token,
      )
    : source;

describe("ModelSection (§4.2/§5.3, judge #6)", () => {
  it("carries the shared-profile note and the saved-for-this-profile line", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={modelControl}
        savedProfileModel="glm-5.3"
        t={t}
      />,
    );
    expect(html).toContain(
      "Changing the model changes the shared profile, not just this session.",
    );
    expect(html).toContain("Saved for this profile:");
    expect(html).toMatch(/<strong[^>]*>glm-5\.3<\/strong>/);
  });

  it("shows the active response's stamp only while a turn runs", () => {
    const render = (turnModel: string | null) =>
      renderToStaticMarkup(
        <ModelSection
          headingId="h"
          control={modelControl}
          savedProfileModel="glm-5.3"
          turnModel={turnModel}
          t={t}
        />,
      );
    expect(render("glm-4.7")).toContain("This response is using:");
    expect(render("glm-4.7")).toContain("<strong>glm-4.7</strong>");
    expect(render(null)).not.toContain("This response is using:");
  });

  it("marks the heading for the pane's initial focus", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="model-heading"
        control={modelControl}
        savedProfileModel="glm-5.3"
        headingRef={() => {}}
        t={t}
      />,
    );
    expect(html).toContain('id="model-heading"');
    expect(html).toMatch(/<h3[^>]*tabindex="-1"/);
  });

  it("renders the disposition notice as a status line and Saving… while busy", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={{ ...modelControl, locked: true }}
        savedProfileModel="glm-5.3"
        notice="Saved. Your next message uses glm-5.3"
        saving
        t={t}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Saved. Your next message uses glm-5.3");
    expect(html).toContain("Saving…");
  });

  it("flags a selection changed in another tab or app", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={modelControl}
        savedProfileModel="glm-4.7"
        externalChange
        t={t}
      />,
    );
    expect(html).toContain("The selection changed in another tab or app");
  });

  it("shows a refused save as Couldn't save and never Saved", () => {
    const html = renderToStaticMarkup(
      <ModelSection
        headingId="h"
        control={modelControl}
        savedProfileModel="glm-4.7"
        notice="Couldn't save: read-only profile"
        t={t}
      />,
    );
    expect(html).toContain("read-only profile");
    expect(html).toContain("Couldn");
  });
});
