import { describe, expect, it } from "vitest";
import {
  chatFileOutputsState,
  FILE_OUTPUTS_ENABLE,
  FILE_OUTPUTS_REVOKE,
  type ChatPermissionFacts,
} from "./file-outputs.ts";

function permission(
  over: Partial<ChatPermissionFacts> = {},
): ChatPermissionFacts {
  return {
    available: true,
    editable: true,
    loading: false,
    busy: false,
    result: {
      current: { mode: "read_only", network: "deny" },
    },
    ...over,
  };
}

describe("chat file outputs state", () => {
  it("reads ON only from the server's own workspace_write + deny readback", () => {
    // Server truth is the only source: a sent request is never enough.
    expect(chatFileOutputsState(permission())).toBe("off");
    expect(
      chatFileOutputsState(
        permission({
          result: { current: FILE_OUTPUTS_ENABLE },
        }),
      ),
    ).toBe("on");
    // A write with an OPEN network is not the allowed chat state.
    expect(
      chatFileOutputsState(
        permission({
          result: { current: { mode: "workspace_write", network: "allow" } },
        }),
      ),
    ).toBe("managed");
    // Full access is out of the chat's scope: no control.
    expect(
      chatFileOutputsState(
        permission({
          result: {
            current: { mode: "danger_full_access", network: "allow" },
          },
        }),
      ),
    ).toBe("managed");
    // A set in flight is applying, never claimed; no server truth is unknown.
    expect(chatFileOutputsState(permission({ busy: true }))).toBe("applying");
    expect(chatFileOutputsState(permission({ result: null }))).toBe("unknown");
  });

  it("only ever sends workspace_write/read_only with the network denied", () => {
    // The two allowed updates pin network to deny: no widening exists here.
    expect([FILE_OUTPUTS_ENABLE, FILE_OUTPUTS_REVOKE]).toEqual([
      { mode: "workspace_write", network: "deny" },
      { mode: "read_only", network: "deny" },
    ]);
  });
});
