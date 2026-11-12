import { describe, expect, it } from "vitest";
import { chatSessionsFromList } from "./chat-session-catalog.ts";

const chat = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  message_count: 0,
  work_mode: "chat" as const,
  workspace_root: `/srv/chats/${id}`,
  ...extra,
});

describe("chatSessionsFromList", () => {
  it("shows only attested chats of this profile, each in its own folder", () => {
    expect(
      chatSessionsFromList("coding", {
        sessions: [
          chat("coding:api:web-a", { title: " Notes ", updated_at: "x" }),
          chat("coding:api:web-code", { work_mode: "code" }),
          chat("coding:api:web-nofolder", { workspace_root: undefined }),
          chat("other:api:web-b"),
        ],
        work_mode: "chat",
        profile_id: "coding",
      }),
    ).toEqual([
      {
        sessionId: "coding:api:web-a",
        profileId: "coding",
        workspaceRoot: "/srv/chats/coding:api:web-a",
        title: "Notes",
        lastPrompt: null,
        updatedAt: null,
      },
    ]);
  });

  it("reads an unattested or foreign listing as no chat listing at all", () => {
    const sessions = [chat("coding:api:web-a")];
    // A server that ignored `work_mode` and listed a folder instead.
    expect(
      chatSessionsFromList("coding", {
        sessions,
        workspace_root: "/srv/work",
        profile_id: "coding",
      }),
    ).toBeNull();
    expect(
      chatSessionsFromList("coding", {
        sessions,
        work_mode: "chat",
        profile_id: "other",
      }),
    ).toBeNull();
  });
});
