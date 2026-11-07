import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConnectionPanel, type ConnectionDraft } from "./ConnectionPanel.tsx";
import { PAIRING_ERROR_COPY } from "./pairing.ts";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";

/**
 * Pairing presentation: no token box during an exchange and bounded copy
 * when the server refuses the link.
 */

const value: ConnectionDraft = {
  endpoint: "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

function panel(props: Partial<Parameters<typeof ConnectionPanel>[0]> = {}) {
  return renderToStaticMarkup(
    <ConnectionPanel
      value={value}
      status="disconnected"
      error={null}
      onChange={() => {}}
      onConnect={() => {}}
      onDisconnect={() => {}}
      onForget={() => {}}
      {...props}
    />,
  );
}

describe("the pairing card", () => {
  it("asks for nothing while the link is being exchanged", () => {
    const html = panel({ pairing: true });
    expect(html).toContain("Opening your pairing link…");
    expect(html).not.toContain("connection-token");
    expect(html).not.toContain("Paste your server token");
    // Cancel stays reachable: a link that never answers is not a trap.
    expect(html).toContain("Cancel");
  });

  it("falls back to the form with bounded copy and the origin prefilled", () => {
    const html = panel({
      pairingError: PAIRING_ERROR_COPY.pair_code_unknown,
    });
    expect(html).toContain(
      "That link was already used. Start the server again for a fresh link.",
    );
    expect(html).toContain('value="http://127.0.0.1:50080"');
    expect(html).toContain("connection-token");
  });
});

describe("the discovery offer", () => {
  it("names one origin and nothing else", () => {
    const html = panel({
      discoveredOrigin: "http://127.0.0.1:18032",
      onUseDiscovered: () => {},
    });
    expect(html).toContain("Found Octos on 127.0.0.1:18032.");
    expect(html).toContain("Connect to 127.0.0.1:18032");
    expect(panel()).not.toContain("Found Octos on");
  });
});

describe("Chinese copy", () => {
  it("translates every refusal kind", () => {
    for (const copy of Object.values(PAIRING_ERROR_COPY)) {
      expect(zh[copy], copy).toBeTruthy();
    }
    for (const source of [
      "Opening your pairing link…",
      "That pairing link did not work",
      "Found Octos on {value0}.",
      "Connect to {value0}",
      "Your token stays in this browser tab. Your server address is remembered.",
    ] as const) {
      expect(zh[source], source).toBeTruthy();
    }
    const html = renderToStaticMarkup(
      <UiTextProvider language="zh" catalog={zh}>
        <ConnectionPanel
          value={value}
          status="disconnected"
          error={null}
          pairingError={PAIRING_ERROR_COPY.pair_code_expired}
          onChange={() => {}}
          onConnect={() => {}}
          onDisconnect={() => {}}
          onForget={() => {}}
        />
      </UiTextProvider>,
    );
    expect(html).toContain("该链接已过期");
  });
});
