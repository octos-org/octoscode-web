import type { PermissionProfileListResult } from "@octos-org/octoscode-client/protocol";
import { describe, expect, it } from "vitest";
import { permissionOptions } from "./permission-projection.ts";

const result: PermissionProfileListResult = {
  session_id: "session-a",
  current: { mode: "workspace_write", network: "deny" },
  profiles: [
    { mode: "read_only", network: "deny" },
    { mode: "workspace_write", network: "deny" },
    { mode: "workspace_write", network: "allow" },
    { mode: "danger_full_access", network: "allow" },
  ],
};
const initial = { mode: "workspace_write", network: "allow" } as const;

describe("permission options", () => {
  it("offers every advertised mode/network combination with explanations", () => {
    const options = permissionOptions(result, initial);
    expect(options).toHaveLength(6);
    expect(options.map((option) => option.id)).toContain("read_only:allow");
    expect(options[0]).toMatchObject({
      id: "workspace_write:allow",
      isDefault: true,
    });
    for (const option of options) expect(option.description).toBeTruthy();
  });

  it("keeps the initial session default after the current permission changes", () => {
    const options = permissionOptions(
      { ...result, current: { mode: "read_only", network: "allow" } },
      initial,
    );
    expect(options.find((option) => option.isDefault)?.id).toBe(
      "workspace_write:allow",
    );
    expect(
      options.find((option) => option.id === "read_only:allow")?.isDefault,
    ).toBe(false);
  });
});
