import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TurnStopButton } from "./TurnStopButton.tsx";

describe("TurnStopButton", () => {
  it("projects an unaccepted start as non-interruptible status", () => {
    const starting = renderToStaticMarkup(
      <TurnStopButton
        activeTurnId="turn-1"
        interruptingTurnId={null}
        available
        starting
        onInterrupt={vi.fn()}
      />,
    );

    expect(starting).toContain("Starting…");
    expect(starting).toContain('disabled=""');
    expect(starting).toContain('aria-busy="true"');
    expect(starting).not.toContain(">Stop</button>");
  });

  it("keeps Starting visible when interrupt is not advertised", () => {
    const starting = renderToStaticMarkup(
      <TurnStopButton
        activeTurnId="turn-1"
        interruptingTurnId={null}
        available={false}
        starting
        onInterrupt={vi.fn()}
      />,
    );

    expect(starting).toContain("Starting…");
    expect(starting).not.toContain(">Stop</button>");
  });

  it("does not expose Stop without turn/interrupt", () => {
    expect(
      renderToStaticMarkup(
        <TurnStopButton
          activeTurnId="turn-1"
          interruptingTurnId={null}
          available={false}
          starting={false}
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
        starting={false}
        onInterrupt={vi.fn()}
      />,
    );
    const stopping = renderToStaticMarkup(
      <TurnStopButton
        activeTurnId="turn-1"
        interruptingTurnId="turn-1"
        available
        starting={false}
        onInterrupt={vi.fn()}
      />,
    );

    expect(ready).toContain(">Stop</button>");
    expect(stopping).toContain("Stopping…");
    expect(stopping).toContain('disabled=""');
    expect(stopping).toContain('aria-busy="true"');
  });
});
