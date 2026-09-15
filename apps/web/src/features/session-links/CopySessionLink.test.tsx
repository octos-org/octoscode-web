import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GeneralSettingsContent } from "../product-settings/GeneralSettingsContent.tsx";
import { CopySessionLink } from "./CopySessionLink.tsx";

const reference = {
  workspaceRoot: "/srv/project",
  profileId: "developer",
  sessionId: "developer:api:web-123",
};

describe("CopySessionLink", () => {
  it("starts without a false success state or exposed routing details", () => {
    const html = renderToStaticMarkup(
      <CopySessionLink reference={reference} />,
    );
    expect(html).toContain("Copy conversation link");
    expect(html).not.toContain("Copied");
    expect(html).not.toContain("web-123");
    expect(html).not.toContain("textarea");
  });

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
