import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSettingsContent } from "../product-settings/GeneralSettingsContent.tsx";

const reference = {
  workspaceRoot: "/srv/project",
  profileId: "developer",
  sessionId: "developer:api:web-123",
};

describe("CopySessionLink", () => {
  it("only exposes the settings action with a confirmed reference", () => {
    const props = {
      serverOrigin: "https://octos.example",
      connectionStatus: "connected" as const,
      onDisconnect: () => undefined,
      onForgetConnection: () => undefined,
    };
    expect(
      renderToStaticMarkup(<GeneralSettingsContent {...props} />),
    ).not.toContain("Copy conversation link");
    const html = renderToStaticMarkup(
      <GeneralSettingsContent {...props} sessionReference={reference} locked />,
    );
    expect(html).toContain("Copy conversation link");
    expect(html).toMatch(/disabled=""[^>]*>Copy conversation link/);
  });
});
