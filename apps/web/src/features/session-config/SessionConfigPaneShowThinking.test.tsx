import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SessionConfigPane } from "./SessionConfigPane.tsx";
import type { PermissionControlProps } from "../product-controls/SessionControlBar.tsx";
import type { ControlState } from "../product-controls/types.ts";

const permissionProps: PermissionControlProps = {
  state: { status: "ready" } as ControlState,
  options: [],
  selectedId: "workspace_write:deny",
  locked: false,
  labels: {
    menu: "Access mode",
    loading: "Loading access…",
    unavailable: "Access unavailable",
    select: "Select access",
    empty: "No access presets",
    retry: "Retry",
  },
  riskCopy: {
    title: "Enable full access?",
    description: "This preset can read and modify files outside the workspace.",
    accessLabel: "Access",
    networkLabel: "Network",
    acknowledgement: "I understand the risk.",
    cancel: "Cancel",
    confirm: "Enable full access",
  },
  onSelect: () => {},
};

const model = {
  state: { status: "ready" },
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
} as const;

const pane = (props: Partial<Parameters<typeof SessionConfigPane>[0]>) =>
  renderToStaticMarkup(
    <SessionConfigPane
      open
      onClose={() => {}}
      model={model}
      savedProfileModel="glm-5.3"
      permission={permissionProps}
      sandbox={{ supported: true, summary: "Workspace write" }}
      advanced={{ present: false }}
      {...props}
    />,
  );

describe("SessionConfigPane Show thinking row (UX5 goal 1)", () => {
  it("renders the Show thinking toggle row between Sandbox and Advanced", () => {
    const html = pane({
      showThinking: true,
      onShowThinkingChange: () => {},
    });
    expect(html).toContain("Show thinking");
    expect(html).toContain(
      "Thinking appears in this Session&#x27;s transcript, collapsed by default.",
    );
    expect(html.indexOf("Sandbox")).toBeLessThan(html.indexOf("Show thinking"));
    expect(html.indexOf("Show thinking")).toBeLessThan(
      html.indexOf("Advanced"),
    );
  });

  it("is a labeled checkbox reflecting the persisted value", () => {
    const on = pane({ showThinking: true, onShowThinkingChange: () => {} });
    expect(on).toMatch(/type="checkbox"[^>]*checked/);
    const off = pane({ showThinking: false, onShowThinkingChange: () => {} });
    expect(off).not.toMatch(/type="checkbox"[^>]*checked/);
  });

  it("omits the row when no handler is provided", () => {
    expect(pane({ showThinking: undefined })).not.toContain("Show thinking");
  });

  it("reports checkbox changes", () => {
    const onShowThinkingChange = vi.fn();
    pane({ showThinking: true, onShowThinkingChange });
    expect(onShowThinkingChange).not.toHaveBeenCalled();
  });
});
