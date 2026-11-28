import { describe, expect, it, vi } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  OctosUiProtocolError,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { findExistingWorkspaceSession } from "./workspace-recovery.ts";

const SCOPED_CAPS = {
  supported_methods: [CORE_UI_METHODS.SESSION_LIST],
  supported_features: [CORE_UI_FEATURES.SESSION_WORKSPACE_CWD_V1],
} as unknown as UiProtocolCapabilities;

describe("findExistingWorkspaceSession", () => {
  it("picks the newest attested canonical session for the profile and ignores foreign or retired rows", async () => {
    const listSessions = vi.fn(async () => ({
      workspace_root: "/srv/proj",
      profile_id: "coding",
      sessions: [
        {
          id: "other:api:web-foreign",
          message_count: 1,
          updated_at: "2026-11-28T05:00:00Z",
        },
        {
          id: "coding:api:web-retired",
          message_count: 1,
          updated_at: "2026-11-28T04:00:00Z",
        },
        {
          id: "coding:api:web-older",
          message_count: 1,
          updated_at: "2026-11-28T02:00:00Z",
        },
        {
          id: "coding:api:web-newest",
          message_count: 1,
          updated_at: "2026-11-28T03:00:00Z",
        },
      ],
    }));

    const found = await findExistingWorkspaceSession(
      { listSessions },
      SCOPED_CAPS,
      "/srv/proj",
      "coding",
      (id) => id === "coding:api:web-retired",
    );

    expect(listSessions).toHaveBeenCalledWith({
      cwd: "/srv/proj",
      profile_id: "coding",
    });
    expect(found).toEqual({
      sessionId: "coding:api:web-newest",
      workspaceRoot: "/srv/proj",
      profileId: "coding",
    });
  });

  it("ignores unscoped or mismatched-profile listings and rethrows auth refusals", async () => {
    const unscoped = await findExistingWorkspaceSession(
      {
        listSessions: async () => ({
          sessions: [{ id: "coding:api:web-a", message_count: 1 }],
        }),
      },
      SCOPED_CAPS,
      "/srv/proj",
      "coding",
    );
    expect(unscoped).toBeNull();

    await expect(
      findExistingWorkspaceSession(
        {
          listSessions: async () => {
            throw new OctosUiProtocolError(-32003, "denied", {
              kind: "auth_scope_violation",
            });
          },
        },
        SCOPED_CAPS,
        "/srv/proj",
        "coding",
      ),
    ).rejects.toThrow("denied");
  });
});
