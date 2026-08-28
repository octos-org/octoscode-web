import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TurnStopButton } from "./TurnStopButton.tsx";

describe("TurnStopButton", () => {
  it("does not expose Stop without turn/interrupt", () => {
    expect(
      renderToStaticMarkup(
        <TurnStopButton
          activeTurnId="turn-1"
          interruptingTurnId={null}
          available={false}
          onInterrupt={vi.fn()}
        />,
      ),
    ).toBe("");
  });

  it("shows and then locks the capability-backed interrupt action", () => {
    const ready = renderToStaticMarkup(
      <TurnStopButton
        activeTurnId="turn-1"
        interruptingTurnId={null}
        available
        onInterrupt={vi.fn()}
      />,
    );
    const stopping = renderToStaticMarkup(
      <TurnStopButton
        activeTurnId="turn-1"
        interruptingTurnId="turn-1"
        available
        onInterrupt={vi.fn()}
      />,
    );

    expect(ready).toContain(">Stop</button>");
    expect(stopping).toContain("Stopping…");
    expect(stopping).toContain('disabled=""');
  });
});
