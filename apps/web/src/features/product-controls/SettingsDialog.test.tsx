import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog, SettingsTrigger } from "./SettingsDialog.tsx";
import { settingsNavigationIntent } from "./selection-policy.ts";

const labels = {
  title: "Settings",
  navigation: "Settings sections",
  general: "General",
  models: "Models",
  close: "Close settings",
};

describe("Settings controls", () => {
  it("keeps the sidebar trigger separate from dialog ownership", () => {
    const trigger = renderToStaticMarkup(
      <SettingsTrigger label="Settings" open={false} onOpen={vi.fn()} />,
    );
    const closedDialog = renderToStaticMarkup(
      <SettingsDialog
        open={false}
        activeSection="general"
        labels={labels}
        slots={{ general: <p>General slot</p>, models: <p>Models slot</p> }}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain("Settings");
    expect(closedDialog).toBe("");
  });

  it("renders only the active slot and identifies the selected nav row", () => {
    const html = renderToStaticMarkup(
      <SettingsDialog
        open
        activeSection="models"
        labels={labels}
        slots={{ general: <p>General slot</p>, models: <p>Models slot</p> }}
        onSectionChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Settings sections"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('data-settings-section="models"');
    expect(html).toContain("Models slot");
    expect(html).not.toContain("General slot");
  });

  it("emits navigation only when the section changes", () => {
    expect(settingsNavigationIntent("general", "models")).toBe("models");
    expect(settingsNavigationIntent("models", "models")).toBeNull();
  });
});
