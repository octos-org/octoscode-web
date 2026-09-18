import { describe, expect, it, vi } from "vitest";
import { createBtwCommands, parseSessionBtwResult } from "./btw.ts";
import type { UiProtocolCapabilities } from "./types.ts";

const session = "dev:local:tui#peer-review";
const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["session/btw"],
  supported_notifications: [],
};

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
  it.each(["", " \n\t"])(
    "rejects empty question %j before RPC",
    async (question) => {
      const request = vi.fn();
      await expect(
        createBtwCommands({ request }, session, caps).ask(question),
      ).rejects.toThrow("required");
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("rejects a runtime object instead of accepting foreign routing fields", async () => {
    const request = vi.fn();
    await expect(
      createBtwCommands({ request }, session, caps).ask({
        question: "Question",
        session_id: "foreign",
      } as unknown as string),
    ).rejects.toThrow("required");
    expect(request).not.toHaveBeenCalled();
  });
  it.each(["", " ", " dev:api:A"])(
    "rejects an unconfirmed owner %j",
    (owner) => {
      expect(() =>
        createBtwCommands({ request: vi.fn() }, owner, caps),
      ).toThrow("confirmed Session");
    },
  );
  it.each([
    { session_id: "dev:local:tui", answer: "foreign topic" },
    { session_id: "other:local:tui#peer-review", answer: "foreign profile" },
    { session_id: session, answer: "" },
    { session_id: session, answer: " \n " },
    { session_id: session, answer: 42 },
    { session_id: session, answer: "answer", model: 42 },
    { session_id: session, answer: "answer", model: " " },
    {},
    null,
  ])("rejects malformed or foreign results %#", (value) => {
    expect(parseSessionBtwResult(value, session)).toBeNull();
  });
  it("preserves complete Markdown and accepts native optional model null", () => {
    expect(
      parseSessionBtwResult(
        {
          session_id: session,
          answer: "**Answer**\n\nDetails",
          model: null,
          unrelated: "ignored",
        },
        session,
      ),
    ).toEqual({ session_id: session, answer: "**Answer**\n\nDetails" });
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
