import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPanel, type ConnectionDraft } from "./ConnectionPanel.tsx";

const value: ConnectionDraft = {
  endpoint: "https://octos.example.test",
  token: "",
  sessionId: "",
  profileId: "",
  cwd: "",
};

describe("ConnectionPanel", () => {
  it("uses the shared Octos mark for connection branding", () => {
    const html = renderToStaticMarkup(
      <ConnectionPanel
        value={value}
        status="disconnected"
        error={null}
        onChange={vi.fn()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onForget={vi.fn()}
      />,
    );

    expect(html).toContain("octoscode");
    expect(html).toContain('data-octopus-logo=""');
    expect(html).not.toContain(">O<");
  });
});
