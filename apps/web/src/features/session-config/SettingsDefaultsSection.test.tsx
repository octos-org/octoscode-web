import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsDefaultsSection } from "./SettingsDefaultsSection.tsx";

const base = {
  open: true,
  modelList: null,
  savedModelName: "glm-5.3",
  defaults: null,
  onDefaultsChange: () => undefined,
};

describe("Settings › Defaults section (§4.4)", () => {
  it("says the model default is shared by every session and tab", () => {
    const html = renderToStaticMarkup(<SettingsDefaultsSection {...base} />);
    expect(html).toContain("Shared by every session and tab of this profile");
  });

  it("notes permission + sandbox apply to sessions created from now on", () => {
    const html = renderToStaticMarkup(<SettingsDefaultsSection {...base} />);
    expect(html).toContain("for sessions you create from now on");
  });

  it("states defaults are never re-applied when reopening a session", () => {
    const html = renderToStaticMarkup(<SettingsDefaultsSection {...base} />);
    expect(html).toContain("Re-opening a session never re-applies these");
  });

  it("renders new-session permission mode + sandbox controls", () => {
    const html = renderToStaticMarkup(<SettingsDefaultsSection {...base} />);
    expect(html).toMatch(/data-defaults-field="permission-mode"/);
    expect(html).toMatch(/data-defaults-field="sandbox-enabled"/);
    expect(html).toMatch(/data-defaults-field="sandbox-network"/);
  });

  it("shows the model control only when the server lists models", () => {
    const withList = renderToStaticMarkup(
      <SettingsDefaultsSection
        {...base}
        modelList={{ control: <p>list</p> }}
      />,
    );
    expect(withList).toMatch(/data-defaults-field="model"/);
    const without = renderToStaticMarkup(<SettingsDefaultsSection {...base} />);
    expect(without).not.toMatch(/data-defaults-field="model"/);
  });
});
