import { describe, expect, it, vi } from "vitest";
import { createBtwCommands } from "./btw.ts";

import { makeCaps } from "./caps.test-fixture.ts";

const session = "dev:local:tui#peer-review";
const caps = makeCaps({ methods: ["session/btw"] });

describe("native session/btw contract", () => {
  it("uses exactly the captured full Session and trimmed question, without a turn or profile override", async () => {
    const request = vi.fn().mockResolvedValue({
      session_id: session,
      answer: "Reading the parser.",
      model: "k3",
    });
    const commands = createBtwCommands({ request }, session, caps);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(await commands.ask("  What are you doing?\n")).toEqual({
      session_id: session,
      answer: "Reading the parser.",
      model: "k3",
    });
    expect(request).toHaveBeenCalledExactlyOnceWith("session/btw", {
      session_id: session,
      question: "What are you doing?",
    });
  });
  it("fails closed without its own method, even when ordinary turn/start exists", async () => {
    const request = vi.fn();
    const commands = createBtwCommands({ request }, session, {
      ...caps,
      supported_methods: ["turn/start"],
    });
    await expect(commands.ask("Question")).rejects.toThrow("not advertised");
    expect(request).not.toHaveBeenCalled();
  });
  it("does not reinterpret a wrong-Session receipt as a successful answer", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ session_id: "dev:api:other", answer: "Not yours" });
    await expect(
      createBtwCommands({ request }, session, caps).ask("Question"),
    ).rejects.toThrow("wrong-Session");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
