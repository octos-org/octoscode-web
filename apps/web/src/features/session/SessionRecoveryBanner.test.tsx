import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionRecoveryBanner } from "./SessionRecoveryBanner.tsx";
import type { SessionRecoverySnapshot } from "./durable-session.ts";

const identity = (text: string) => text;

function render(
  phase: SessionRecoverySnapshot["phase"],
  extra: Partial<SessionRecoverySnapshot> = {},
  onReload: (() => Promise<void>) | null = async () => {},
) {
  return renderToStaticMarkup(
    <SessionRecoveryBanner
      recovery={{
        phase,
        sessionId: "coding:local:main",
        reconnectAttempt: 0,
        ...extra,
      }}
      {...(onReload ? { onReload } : {})}
      t={identity}
    />,
  );
}

describe("SessionRecoveryBanner", () => {
  it("offers a way out of a recovery that will not resolve itself", () => {
    const html = render("error", { detail: "Recovery buffer exceeded" });
    expect(html).toContain("Session recovery required");
    expect(html).toContain("Recovery buffer exceeded");
    expect(html).toContain("Reload session");
    expect(html).toContain("will not recover on its own");
    // The old copy claimed a reconnect that is not happening.
    expect(html).not.toContain("Your session is reconnecting");
  });

  it.each(["gap", "lossy", "idle"] as const)(
    "offers the reload for the stalled %s phase too",
    (phase) => {
      expect(render(phase)).toContain("Reload session");
    },
  );

  it.each(["reconnecting", "hydrating"] as const)(
    "waits without a button while %s is in flight",
    (phase) => {
      const html = render(phase);
      expect(html).not.toContain("Reload session");
      expect(html).toContain("Your session is reconnecting");
    },
  );

  it("renders no button when the host wires no reload", () => {
    expect(render("error", {}, null)).not.toContain("Reload session");
  });
});
