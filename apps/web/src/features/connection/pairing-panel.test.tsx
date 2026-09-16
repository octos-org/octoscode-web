import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ConnectionPanel, type ConnectionDraft } from "./ConnectionPanel.tsx";
import { PAIRING_ERROR_COPY } from "./pairing.ts";
import { UiTextProvider } from "../preferences/ui-text.tsx";
import zh from "../preferences/zh.ts";

/**
 * WEB-PAIRING-CONTRACT-5100 §Client + §Remembering, as the panel presents
 * them: no token box while a link is being exchanged, bounded copy for a
 * refusal, and one visible line naming the storage actually in effect.
 */
const app = readFileSync(new URL("../../app/App.tsx", import.meta.url), "utf8");
const main = readFileSync(new URL("../../main.tsx", import.meta.url), "utf8");
// The claim lives in the entry, which owns the connect screen: the product
// shell is not loaded while a link is being exchanged.
const gate = readFileSync(
  new URL("../../app/ConnectionGate.tsx", import.meta.url),
  "utf8",
);

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

describe("the storage line", () => {
  it("names the storage in effect and offers Forget", () => {
    expect(panel({ tokenStorage: "tab" })).toContain(
      "Your token stays in this browser tab.",
    );
    expect(panel({ tokenStorage: "device", remember: true })).toContain(
      "Your token is remembered on this device.",
    );
    const blocked = panel({ tokenStorage: "memory" });
    expect(blocked).toContain("This browser blocked saved data");
    expect(blocked).toContain('data-token-storage="memory"');
    expect(panel()).toContain("Forget saved connection");
  });

  it("renders the Remember checkbox in both states", () => {
    const off = panel({ onRememberChange: () => {} });
    expect(off).toContain("Remember on this device");
    expect(off).not.toContain('name="remember" checked');
    expect(panel({ remember: true, onRememberChange: () => {} })).toContain(
      'name="remember" checked',
    );
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
  it("translates every refusal kind and every storage line", () => {
    for (const copy of Object.values(PAIRING_ERROR_COPY)) {
      expect(zh[copy], copy).toBeTruthy();
    }
    for (const source of [
      "Opening your pairing link…",
      "That pairing link did not work",
      "Remember on this device",
      "Found Octos on {value0}.",
      "Connect to {value0}",
      "Your token is remembered on this device. Your server address is remembered.",
      "Your token stays in this browser tab. Your server address is remembered.",
      "This browser blocked saved data, so your token is kept in memory only and is gone when you close this tab.",
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
          tokenStorage="device"
          remember
          onRememberChange={() => {}}
          onChange={() => {}}
          onConnect={() => {}}
          onDisconnect={() => {}}
          onForget={() => {}}
        />
      </UiTextProvider>,
    );
    expect(html).toContain("该链接已过期");
    expect(html).toContain("在此设备上记住");
    expect(html).toContain("令牌已记在此设备上");
  });
});

describe("the app consumes the link before it can leak", () => {
  it("strips the address in main.tsx, ahead of createRoot", () => {
    const consumed = main.indexOf("consumePairingLink()");
    const rendered = main.indexOf("createRoot(");
    expect(consumed).toBeGreaterThan(-1);
    expect(consumed).toBeLessThan(rendered);
  });

  it("never writes the code or the raw link into storage or a log", () => {
    expect(gate).toMatch(/claimPairingCode\(pairingLink/);
    // The only thing that reaches storage is the token and the origin.
    for (const source of [gate, app]) {
      expect(source).not.toMatch(/rememberToken\([^)]*pairingLink/);
      expect(source).not.toMatch(/console\.[a-z]+\([^)]*pairingLink/);
      expect(source).not.toMatch(/setItem\([^)]*pairingLink/);
    }
    const pairing = readFileSync(
      new URL("./pairing.ts", import.meta.url),
      "utf8",
    );
    expect(pairing).not.toContain("console.");
    expect(pairing).not.toContain("localStorage");
    expect(pairing).not.toContain("sessionStorage");
  });
});
