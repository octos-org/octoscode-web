import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlanUpdated } from "@octos-org/octoscode-client/protocol";
import { PlanCard } from "./PlanCard.tsx";
import { UiTextProvider } from "../preferences/ui-text.tsx";

const plan: PlanUpdated = {
  sessionId: "session-1",
  turnId: "turn-1",
  updatedAtMs: 0,
  items: [
    { id: "a", title: "Read the contract", status: "completed" },
    { id: "b", title: "Write the card", status: "in_progress" },
    { id: "c", title: "Run the checks", status: "pending", priority: "P2" },
  ],
};

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("PlanCard", () => {
  it("names the work, counts progress and labels every row", () => {
    const markup = render(<PlanCard plan={plan} now={5 * 60_000} />);
    // No server title: the in-progress item names what is happening now.
    expect(markup).toContain("Write the card");
    expect(markup).toContain("1 of 3 done");
    expect(markup).toContain("Done");
    expect(markup).toContain("In progress");
    expect(markup).toContain("Pending");
    expect(markup).toContain("P2");
    expect(markup).toContain("Updated 5m ago");
  });

  it("prefers the server's own title over the in-progress item", () => {
    const markup = render(
      <PlanCard plan={{ ...plan, title: "Shipping the card" }} />,
    );
    expect(markup).toContain("Shipping the card");
  });

  it("opens expanded, is operable as a button and points at the list it controls", () => {
    const markup = render(<PlanCard plan={plan} />);
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-expanded="true"');
    const controls = /aria-controls="([^"]+)"/.exec(markup)?.[1];
    expect(controls).toBeTruthy();
    expect(markup).toContain(`id="${controls}"`);
    // The list is present and visible while expanded.
    expect(markup).not.toContain('hidden=""');
  });

  it("announces one short summary rather than re-reading every row", () => {
    const markup = render(<PlanCard plan={plan} />);
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain("Plan: 1 of 3 done");
  });

  it("translates its own chrome but never the model's item prose", () => {
    const markup = render(
      <UiTextProvider language="zh" catalog={{ Pending: "待办" }}>
        <PlanCard plan={plan} />
      </UiTextProvider>,
    );
    expect(markup).toContain("待办");
    expect(markup).toContain("Read the contract");
  });
});
