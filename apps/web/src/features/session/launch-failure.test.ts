import { describe, expect, it } from "vitest";
import {
  CHAT_WORKSPACE_RESERVED_MESSAGE,
  isChatWorkspaceReservedError,
  launchFailureMessage,
} from "./launch-failure.ts";

const rpcReserved = Object.assign(new Error("this folder belongs to or holds chats"), {
  name: "OctosUiProtocolError",
  code: -32120,
  data: { kind: "chat_workspace_reserved" },
});

describe("chat workspace reserved launch failure", () => {
  it("detects the typed refusal by its data kind", () => {
    expect(isChatWorkspaceReservedError(rpcReserved)).toBe(true);
    expect(isChatWorkspaceReservedError(new Error("boom"))).toBe(false);
    expect(isChatWorkspaceReservedError(
      Object.assign(new Error("x"), { data: { kind: "unknown_session" } }),
    )).toBe(false);
    expect(isChatWorkspaceReservedError(null)).toBe(false);
  });

  it("surfaces an actionable product message, not the generic open failure", () => {
    expect(launchFailureMessage(rpcReserved)).toBe(CHAT_WORKSPACE_RESERVED_MESSAGE);
    expect(launchFailureMessage(rpcReserved)).not.toBe(
      "The new coding session could not be opened.",
    );
    expect(launchFailureMessage(new Error("plain"))).toBe("plain");
  });
});
