import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog } from "./SettingsDialog.tsx";

const labels = {
  title: "Settings",
  navigation: "Settings sections",
  general: "General",
  models: "Models",
  skills: "Skills",
  memory: "Memory",
  close: "Close settings",
};

describe("SettingsDialog optional sections", () => {
  it("hides Skills and Memory without capability-backed slots", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog
        open
        activeSection="general"
        labels={labels}
        slots={{ general: <p>General</p> }}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("General");
    expect(html).not.toContain("Skills");
    expect(html).not.toContain("Memory");
  });

  it("renders and labels a capability-backed skills panel", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog
        open
        activeSection="skills"
        labels={labels}
        slots={{ general: <p>General</p>, skills: <p>Skill content</p> }}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Skill content");
    expect(html).toContain('data-settings-section="skills"');
    expect(html).toContain("Skills");
  });

  it("renders and labels a capability-backed memory panel", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog
        open
        activeSection="memory"
        labels={labels}
        slots={{ general: <p>General</p>, memory: <p>Memory content</p> }}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(html).toContain("Memory content");
    expect(html).toContain('data-settings-section="memory"');
    expect(html).toContain("Memory");
  });
});
