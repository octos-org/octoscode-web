import { describe, expect, it, vi } from "vitest";
import type { OctosUiClient } from "@octos-org/octoscode-client/protocol";
import { applyTemplateReadOnly } from "./template-permission.ts";

function clientWith(result: {
  session_id: string;
  applied: boolean;
  current: { mode: string; network: string };
}) {
  const setPermissionProfile = vi.fn().mockResolvedValue(result);
  return {
    client: { setPermissionProfile } as unknown as OctosUiClient,
    setPermissionProfile,
  };
}

describe("read-only template permission", () => {
  it("sets only the mode and requires a matching read-only receipt", async () => {
    const { client, setPermissionProfile } = clientWith({
      session_id: "session-a",
      applied: true,
      current: { mode: "read_only", network: "allow" },
    });
    await applyTemplateReadOnly(client, "session-a");
    expect(setPermissionProfile).toHaveBeenCalledWith({
      session_id: "session-a",
      update: { mode: "read_only" },
    });
  });

  it.each([
    { session_id: "session-b", applied: true },
    { session_id: "session-a", applied: false },
  ])("rejects an unconfirmed receipt: %o", async (override) => {
    const { client } = clientWith({
      current: { mode: "read_only", network: "allow" },
      ...override,
    });
    await expect(applyTemplateReadOnly(client, "session-a")).rejects.toThrow(
      "did not confirm read-only",
    );
  });

  it("rejects a receipt that leaves write permission in place", async () => {
    const { client } = clientWith({
      session_id: "session-a",
      applied: true,
      current: { mode: "workspace_write", network: "allow" },
    });
    await expect(applyTemplateReadOnly(client, "session-a")).rejects.toThrow(
      "did not confirm read-only",
    );
  });
});
