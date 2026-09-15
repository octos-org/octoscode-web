import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GeneralSettingsContent } from "./GeneralSettingsContent.tsx";
import { ModelsSettingsContent } from "./ModelsSettingsContent.tsx";

const groups = [
  {
    id: "zai",
    name: "Z.AI",
    models: [
      { id: "glm-5.2", name: "GLM-5.2", available: true },
      {
        id: "glm-legacy",
        name: "GLM Legacy",
        available: false,
        unavailableReason: "Not included in this plan",
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
] as const;

describe("GeneralSettingsContent", () => {
  it("shows product context without exposing connection or session forms", () => {
    const html = renderToStaticMarkup(
      <GeneralSettingsContent
        serverOrigin="https://octos.example.test"
        connectionStatus="connected"
        workspaceLabel="octoscode-web"
        workspacePath="/srv/work/octoscode-web"
        agentPreset="Coding"
        displayProfile="GLM Coding Plan"
        onDisconnect={vi.fn()}
        onForgetConnection={vi.fn()}
      />,
    );

    expect(html).toContain("Connected");
    expect(html).toContain("https://octos.example.test");
    expect(html).toContain("octoscode-web");
    expect(html).toContain("/srv/work/octoscode-web");
    expect(html).toContain("Coding");
    expect(html).toContain("GLM Coding Plan");
    expect(html).toContain("Disconnect");
    expect(html).toContain("Forget server");
    expect(html).not.toContain("Session id");
    expect(html).not.toContain("Auth token");
    expect(html).not.toContain("<input");
  });

  it("keeps disconnect unavailable when there is no active connection", () => {
    const html = renderToStaticMarkup(
      <GeneralSettingsContent
        serverOrigin="https://octos.example.test"
        connectionStatus="disconnected"
        onDisconnect={vi.fn()}
        onForgetConnection={vi.fn()}
      />,
    );

    expect(html).toContain("Disconnected");
    expect(html).toMatch(/disabled=""[^>]*>Disconnect<\/button>/);
    expect(html).not.toContain("Current workspace");
  });
});

describe("ModelsSettingsContent", () => {
  it("separates Session runtime from one cross-provider Profile default", () => {
    const html = renderToStaticMarkup(
      <ModelsSettingsContent
        state={{ status: "ready" }}
        groups={groups}
        selected={{ providerId: "zai", modelId: "glm-5.2" }}
        runtimeModel="DeepSeek V4 Pro"
        restartRequired={false}
        selectionEnabled
        locked={false}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Z.AI");
    expect(html).toContain("DeepSeek");
    expect(html).toContain("GLM-5.2");
    expect(html).toContain("DeepSeek V4 Pro");
    expect(html).toContain("Session runtime");
    expect(html).toContain("Profile default");
    expect(html).toContain('aria-label="Profile default model"');
    expect(html.match(/role="radiogroup"/g)).toHaveLength(1);
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/disabled=""[^>]*><span[^>]*><span[^>]*>GLM Legacy/);
    expect(html).toContain("Not included in this plan");
  });

  it("renders an advertised but immutable Profile catalog without fake controls", () => {
    const html = renderToStaticMarkup(
      <ModelsSettingsContent
        state={{ status: "ready" }}
        groups={groups}
        selected={{ providerId: "zai", modelId: "glm-5.2" }}
        runtimeModel="DeepSeek V4 Pro"
        restartRequired={false}
        selectionEnabled={false}
        locked={false}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain("Profile defaults are read-only on this server.");
    expect(html).toContain('aria-label="Configured profile models"');
    expect(html).toContain('data-profile-default="true"');
    expect(html).not.toContain('role="radio"');
    expect(html).not.toContain('role="radiogroup"');
  });

  it("makes capability, failure, and restart states product-readable", () => {
    const unavailable = renderToStaticMarkup(
      <ModelsSettingsContent
        state={{ status: "unavailable" }}
        groups={[]}
        selected={null}
        runtimeModel={null}
        restartRequired={false}
        selectionEnabled={false}
        locked={false}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );
    const failed = renderToStaticMarkup(
      <ModelsSettingsContent
        state={{ status: "error", message: "Catalog timed out" }}
        groups={[]}
        selected={null}
        runtimeModel="DeepSeek V4 Pro"
        restartRequired
        selectionEnabled
        locked={false}
        onRefresh={vi.fn()}
        onSelect={vi.fn()}
      />,
    );

    expect(unavailable).toContain(
      "This Octos server does not advertise profile model management.",
    );
    expect(unavailable).not.toContain('role="radiogroup"');
    expect(unavailable).not.toContain(">Refresh</button>");
    expect(failed).toContain("Catalog timed out");
    expect(failed).toContain("Try again");
    expect(failed).toContain("Restart Octos to apply the new default");
  });
});
