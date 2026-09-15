import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModelMenu, SessionControlBar } from "./SessionControlBar.tsx";
import {
  modelSelectionIntent,
  permissionSelectionIntent,
} from "./selection-policy.ts";
import type {
  ModelControlLabels,
  ModelProviderGroup,
  PermissionControlLabels,
  PermissionRiskCopy,
  SessionPermissionOption,
} from "./types.ts";

const permissionLabels: PermissionControlLabels = {
  menu: "Access mode",
  loading: "Loading access…",
  unavailable: "Access unavailable",
  select: "Select access",
  empty: "No access presets",
  retry: "Retry",
};

const riskCopy: PermissionRiskCopy = {
  title: "Enable full access?",
  description: "This preset can read and modify files outside the workspace.",
  accessLabel: "Access",
  networkLabel: "Network",
  acknowledgement: "I understand the risk.",
  cancel: "Cancel",
  confirm: "Enable full access",
};

const permissionOptions: readonly SessionPermissionOption[] = [
  {
    id: "workspace-deny",
    mode: "workspace_write",
    network: "deny",
    modeLabel: "Workspace write",
    networkLabel: "Network blocked",
    risk: "standard",
  },
  {
    id: "full-allow",
    mode: "danger_full_access",
    network: "allow",
    modeLabel: "Full access",
    networkLabel: "Network allowed",
    description: "Unrestricted filesystem and network access",
    risk: "dangerous",
  },
];

const modelLabels: ModelControlLabels = {
  menu: "Model",
  loading: "Loading models…",
  unavailable: "Models unavailable",
  select: "Select model",
  empty: "No models available",
  retry: "Retry",
};

const modelGroups: readonly ModelProviderGroup[] = [
  {
    id: "zai",
    name: "Z.AI",
    models: [
      { id: "glm-5.2", name: "GLM-5.2", available: true },
      {
        id: "glm-retired",
        name: "GLM Retired",
        available: false,
        unavailableReason: "Not available on this plan",
      },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    models: [
      {
        id: "deepseek-v4-pro",
        name: "DeepSeek V4 Pro",
        description: "Coding model",
        available: true,
      },
    ],
  },
];

describe("SessionControlBar", () => {
  it("does not turn an empty runtime label into a model claim", () => {
    const html = renderToStaticMarkup(
      <SessionControlBar
        ariaLabel="Session controls"
        permission={null}
        model={null}
        runtimeModel={{ label: " ", onOpenSettings: vi.fn() }}
      />,
    );

    expect(html).toContain("Runtime not reported");
    expect(html).toContain(
      'aria-label="Runtime model: not reported. Open Settings."',
    );
  });

  it("does not create a runtime model seat without status/read", () => {
    const html = renderToStaticMarkup(
      <SessionControlBar
        ariaLabel="Session controls"
        permission={{
          state: { status: "ready" },
          options: permissionOptions,
          selectedId: "workspace-deny",
          locked: false,
          labels: permissionLabels,
          riskCopy,
          onSelect: vi.fn(),
        }}
        model={null}
        runtimeModel={null}
      />,
    );

    expect(html).toContain('data-control-seat="permission"');
    expect(html).not.toContain('data-control-seat="model"');
    expect(html).not.toContain("Runtime model");
  });

  it("routes dangerous choices through confirmation and never direct selection", () => {
    expect(
      permissionSelectionIntent(permissionOptions[0]!, null, false),
    ).toEqual({
      kind: "select",
      option: permissionOptions[0],
    });
    expect(
      permissionSelectionIntent(permissionOptions[1]!, null, false),
    ).toEqual({
      kind: "confirm",
      option: permissionOptions[1],
    });
  });
});

describe("ModelMenu", () => {
  it("groups the authoritative catalog by provider and explains disabled models", () => {
    const html = renderToStaticMarkup(
      <ModelMenu
        menuId="model-menu"
        state={{ status: "ready" }}
        groups={modelGroups}
        selected={{ providerId: "zai", modelId: "glm-5.2" }}
        locked={false}
        labels={modelLabels}
        onChoose={vi.fn()}
      />,
    );

    expect(html).toContain("Z.AI");
    expect(html).toContain("DeepSeek");
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/disabled=""[^>]*><span[^>]*><span[^>]*>GLM Retired/);
    expect(html).toContain("Not available on this plan");
  });

  it("returns only usable, changed selections", () => {
    expect(
      modelSelectionIntent(
        "deepseek",
        modelGroups[1]!.models[0]!,
        { providerId: "zai", modelId: "glm-5.2" },
        false,
      ),
    ).toEqual({
      kind: "select",
      selection: { providerId: "deepseek", modelId: "deepseek-v4-pro" },
    });
    expect(
      modelSelectionIntent("zai", modelGroups[0]!.models[1]!, null, false),
    ).toEqual({
      kind: "none",
    });
  });
});
