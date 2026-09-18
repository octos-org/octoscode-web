import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnRecoveryNotice } from "./TurnRecoveryNotice.tsx";
import type { TurnRecoveryState } from "./use-turn-controller.ts";

function render(phase: TurnRecoveryState["phase"], withContinue = true) {
  return renderToStaticMarkup(
    <TurnRecoveryNotice
      recovery={{ turnId: "turn-1", phase }}
      onRetry={() => {}}
      {...(withContinue ? { onContinue: () => {} } : {})}
    />,
  );
}

describe("TurnRecoveryNotice", () => {
  it("offers a way out once the status stays unknown", () => {
    const html = render("unknown");
    expect(html).toContain("Check status");
    expect(html).toContain("Continue without it");
    expect(html).toContain("Nothing is sent again");
  });

  it("offers continue when the server cannot check status at all", () => {
    const html = render("unavailable");
    expect(html).not.toContain("Check status");
    expect(html).toContain("Continue without it");
  });

  it("offers continue after a failed status check", () => {
    expect(render("error")).toContain("Continue without it");
  });

  it("hides continue while a status check is in flight", () => {
    const html = render("checking");
    expect(html).toContain("Checking status…");
    expect(html).not.toContain("Continue without it");
  });

  it("renders no continue button when no handler is wired", () => {
    expect(render("unknown", false)).not.toContain("Continue without it");
  });
});
