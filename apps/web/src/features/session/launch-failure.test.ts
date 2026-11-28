import { describe, expect, it } from "vitest";
import { CHAT_WORKSPACE_RESERVED_MESSAGE, isChatWorkspaceReservedError, launchFailureMessage } from "./launch-failure.ts";

const reserved = Object.assign(new Error("this folder belongs to or holds chats"), {
  name: "OctosUiProtocolError",
  data: { kind: "chat_workspace_reserved" },
});

describe("chat workspace reserved launch failure", () => {
  it("detects the kind and surfaces an actionable message, not the generic one", () => {
    expect(isChatWorkspaceReservedError(reserved)).toBe(true);
    expect(isChatWorkspaceReservedError(new Error("x"))).toBe(false);
    expect(isChatWorkspaceReservedError(null)).toBe(false);
    expect(launchFailureMessage(reserved)).toBe(CHAT_WORKSPACE_RESERVED_MESSAGE);
    expect(launchFailureMessage(new Error("plain"))).toBe("plain");
  });
});
