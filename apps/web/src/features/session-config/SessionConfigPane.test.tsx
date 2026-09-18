import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  dispositionNotice,
  SessionConfigPane,
  type SessionModelResult,
} from "./SessionConfigPane.tsx";
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

describe("SessionConfigPane (§4.2)", () => {
  it("renders the four sections in order on a ModalSurface dialog", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{
          supported: true,
          summary: "Workspace write · network blocked",
        }}
        advanced={{ present: false }}
      />,
    );
    expect(html).toContain('role="dialog"');
    expect(html.indexOf("Model")).toBeLessThan(html.indexOf("Permissions"));
    expect(html.indexOf("Permissions")).toBeLessThan(html.indexOf("Sandbox"));
    expect(html.indexOf("Sandbox")).toBeLessThan(html.indexOf("Advanced"));
  });

  it("Model section carries the shared-profile note and saved-model line", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{
          supported: true,
          summary: "Workspace write · network blocked",
        }}
        advanced={{ present: false }}
      />,
    );
    expect(html).toContain(
      "Changing the model changes the shared profile, not just this session.",
    );
    expect(html).toContain("Saved for this profile:");
    expect(html).toMatch(/<strong[^>]*>glm-5\.3<\/strong>/);
  });

  it("shows the running-response model only while a turn runs", () => {
    const pane = (turnModel: string | null) =>
      renderToStaticMarkup(
        <SessionConfigPane
          open
          onClose={() => {}}
          model={{
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
          }}
          savedProfileModel="glm-5.3"
          permission={permissionProps}
          sandbox={{ supported: true, summary: "Workspace write" }}
          advanced={{ present: false }}
          turnModel={turnModel}
        />,
      );
    expect(pane("glm-4.7")).toContain("This response is using:");
    expect(pane("glm-4.7")).toMatch(/<strong[^>]*>glm-4\.7<\/strong>/);
    expect(pane(null)).not.toContain("This response is using:");
  });

  it("Permissions section discloses next-message timing and readback", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{ supported: true, summary: "Workspace write" }}
        advanced={{ present: false }}
      />,
    );
    expect(html).toContain("Applies from your next message.");
    expect(html).toContain(
      "A response that is already running keeps the permissions it started with.",
    );
  });

  it("Sandbox section is read-only with the fixed-at-open note", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{
          supported: true,
          summary: "Workspace write · read /workspace",
        }}
        advanced={{ present: false }}
      />,
    );
    expect(html).toContain("Workspace write · read /workspace");
    expect(html).toContain(
      "Set when the session opens — start a new session to change it",
    );
  });

  it("Sandbox says Not supported by this server when the feature is absent", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{ supported: false, summary: null }}
        advanced={{ present: false }}
      />,
    );
    expect(html).toContain("Not supported by this server");
  });

  it("Advanced section stays collapsed and holds the driver seat", () => {
    const html = renderToStaticMarkup(
      <SessionConfigPane
        open
        onClose={() => {}}
        model={{
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
        }}
        savedProfileModel="glm-5.3"
        permission={permissionProps}
        sandbox={{ supported: true, summary: "Workspace write" }}
        advanced={{
          present: true,
          controller: "This tab",
          bindingOwner: "driver-1",
          epoch: 3,
          leaseExpiry: null,
          advancedChildren: <div data-testid="advanced-seat" />,
        }}
      />,
    );
    expect(html).toContain("<details");
    expect(html).not.toContain('open="">');
    expect(html).toContain("Who controls this session");
    expect(html).toContain("This tab");
  });

  it("maps every runtime_disposition to its exact message", () => {
    const saved: SessionModelResult = { selection: "glm-5.3" };
    expect(dispositionNotice({ disposition: "reloaded", saved })).toBe(
      "Saved. Your next message uses glm-5.3",
    );
    expect(
      dispositionNotice({
        disposition: "deferred",
        saved,
        condition: "profile disabled",
      }),
    ).toBe("Saved. The model is not active yet (profile disabled)");
    expect(
      dispositionNotice({
        disposition: "restart_required",
        saved,
        running: "glm-4.7",
      }),
    ).toBe("Saved. The server keeps running glm-4.7 until it restarts");
    expect(
      dispositionNotice({
        disposition: "persisted_but_not_live",
        saved,
        runtimeError: "no provider for family",
      }),
    ).toBe("Saved, but not usable right now: no provider for family");
    expect(dispositionNotice({ disposition: "unchanged", saved })).toBe(
      "Already selected",
    );
  });

  it("a refused save is never Saved", () => {
    const refused: SessionModelResult = { selection: "glm-5.3" };
    expect(
      dispositionNotice({
        disposition: "refused",
        saved: refused,
        reason: "read-only profile",
      }),
    ).toBe("Couldn't save: read-only profile");
  });
});
