import { describe, expect, it } from "vitest";
import type { HydratedMessage } from "@octos-org/octoscode-client";
import { conversationMarkdown } from "./conversation-markdown.ts";

let nextSeq = 0;
function message(
  role: string,
  content: string,
  extra: Partial<HydratedMessage> = {},
): HydratedMessage {
  return {
    seq: nextSeq++,
    role,
    content,
    persisted_at: "2026-09-25T00:00:00Z",
    media: [],
    ...extra,
  };
}

describe("conversationMarkdown", () => {
  it("renders a header and alternating user / assistant sections", () => {
    nextSeq = 0;
    const markdown = conversationMarkdown({
      sessionId: "dev:api:web-1",
      workspaceRoot: "/srv/work/new-octos",
      messages: [
        message("user", "How do I make the deck editable?"),
        message("assistant", "Split each slide into **layers**."),
      ],
    });
    expect(markdown).toBe(
      [
        "# new-octos",
        "",
        "- Workspace: `/srv/work/new-octos`",
        "- Session: `dev:api:web-1`",
        "",
        "## User",
        "",
        "How do I make the deck editable?",
        "",
        "## Assistant",
        "",
        "Split each slide into **layers**.",
        "",
      ].join("\n"),
    );
  });

  it("keeps only the chat: drops tool output, hidden reasoning, system rows and empty messages", () => {
    nextSeq = 0;
    const markdown = conversationMarkdown({
      sessionId: "dev:api:web-1",
      messages: [
        message("user", "Run the build"),
        message("assistant", "", { reasoning_content: "private thinking" }),
        message("tool", "cargo output\n".repeat(50)),
        message("system", "internal note"),
        message("assistant", "The build passed.", {
          reasoning_content: "more private thinking",
        }),
      ],
    });
    expect(markdown).not.toContain("cargo output");
    expect(markdown).not.toContain("private thinking");
    expect(markdown).not.toContain("internal note");
    expect(markdown.match(/^## Assistant$/gm)).toHaveLength(1);
    expect(markdown).toContain("## User\n\nRun the build\n");
    expect(markdown).toContain("## Assistant\n\nThe build passed.\n");
  });

  it("merges consecutive messages of one speaker into a single section", () => {
    // An agent turn is many assistant rows around tool calls; the reader wants
    // one reply per turn, not a heading per segment.
    nextSeq = 0;
    const markdown = conversationMarkdown({
      sessionId: "s",
      messages: [
        message("user", "Check it"),
        message("assistant", "Looking now."),
        message("tool", "ok"),
        message("assistant", "Found the bug."),
        message("user", "Fix it"),
      ],
    });
    expect(markdown.match(/^## /gm)).toEqual(["## ", "## ", "## "]);
    expect(markdown).toContain(
      "## Assistant\n\nLooking now.\n\nFound the bug.\n",
    );
  });

  it("treats roles case-insensitively and trims surrounding blank lines only", () => {
    nextSeq = 0;
    const markdown = conversationMarkdown({
      sessionId: "s",
      messages: [message("User", "\n\n  indented code\n\n")],
    });
    expect(markdown).toContain("## User\n\n  indented code\n");
  });

  it("prefers an explicit title and falls back to a generic one", () => {
    nextSeq = 0;
    const messages = [message("user", "hi")];
    expect(
      conversationMarkdown({
        sessionId: "s",
        title: "检查尚未完成的任务",
        workspaceRoot: "/p",
        messages,
      }).split("\n")[0],
    ).toBe("# 检查尚未完成的任务");
    expect(
      conversationMarkdown({ sessionId: "s", messages }).split("\n")[0],
    ).toBe("# Conversation");
  });

  it("says so when the server's history has gaps, and not otherwise", () => {
    const complete = [0, 1, 2].map((seq) => ({
      ...message("user", `m${seq}`),
      seq,
    }));
    expect(
      conversationMarkdown({ sessionId: "s", messages: complete }),
    ).not.toContain("Incomplete");
    const gappy = [0, 1, 7].map((seq) => ({
      ...message("user", `m${seq}`),
      seq,
    }));
    expect(conversationMarkdown({ sessionId: "s", messages: gappy })).toContain(
      "> Incomplete: the server returned 3 messages spanning seq 0–7; the missing ones are not included.",
    );
  });

  it("returns nothing to copy for a conversation with no chat text", () => {
    nextSeq = 0;
    expect(
      conversationMarkdown({
        sessionId: "s",
        messages: [message("tool", "only tool output")],
      }),
    ).toBe("");
    expect(conversationMarkdown({ sessionId: "s", messages: [] })).toBe("");
  });
});
