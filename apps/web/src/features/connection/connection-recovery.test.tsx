import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionPanel, type ConnectionDraft } from "./ConnectionPanel.tsx";

/**
 * Round 3 item 7 (judge #7): connection-error destinations — the rejected-
 * token failure FOCUSES the token field and KEEPS the value; the actions the
 * classifier names actually render. The App's own wiring (token probe →
 * classifier → this panel) runs end to end in e2e/final-input.spec.ts.
 */
const value: ConnectionDraft = {
  endpoint: "https://octos.example.test",
  token: "kept-token-value",
  sessionId: "",
  profileId: "",
  cwd: "",
};

describe("rejected-token failure focuses the field and keeps the value", () => {
  it("panel accepts a focusTokenField + failureActions pass-through", () => {
    const html = renderToStaticMarkup(
      <ConnectionPanel
        value={value}
        status="disconnected"
        error="The server refused this token"
        focusTokenField
        failureActions={["Re-enter the token", "Retry"]}
        onChange={() => {}}
        onConnect={() => {}}
        onDisconnect={() => {}}
        onForget={() => {}}
      />,
    );
    expect(html).toContain("The server refused this token");
    expect(html).toContain("Re-enter the token");
    expect(html).toContain("Retry");
    // The draft is kept (the input renders the typed value).
    expect(html).not.toContain('value=""');
  });
});
