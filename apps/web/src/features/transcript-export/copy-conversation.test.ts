import { describe, expect, it, vi } from "vitest";
import type { SessionHydrateResult } from "@octos-org/octoscode-client";
import {
  copyConversationMarkdown,
  type ConversationClipboard,
} from "./copy-conversation.ts";

function history(
  sessionId: string,
  messages: { role: string; content: string }[],
): SessionHydrateResult {
  return {
    session_id: sessionId,
    cursor: { stream: sessionId, seq: messages.length },
    messages: messages.map((message, seq) => ({
      ...message,
      seq,
      persisted_at: "2026-09-25T00:00:00Z",
      media: [],
    })),
  };
}

function source(result: SessionHydrateResult | Error) {
  const hydrateSession = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return {
    hydrateSession,
    source: {
      client: { hydrateSession },
      sessionId: "dev:api:web-1",
      workspaceRoot: "/srv/p",
    },
  };
}

class FakeClipboardItem {
  constructor(readonly items: Record<string, Promise<Blob>>) {}
}

describe("copyConversationMarkdown", () => {
  const chat = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi there" },
  ];

  it("reads canonical messages for the Session and writes Markdown as text", async () => {
    const s = source(history("dev:api:web-1", chat));
    const writeText = vi.fn(async (_text: string) => undefined);
    const clipboard: ConversationClipboard = { writeText };
    await expect(copyConversationMarkdown(s.source, clipboard)).resolves.toBe(
      "copied",
    );
    expect(s.hydrateSession).toHaveBeenCalledWith({
      session_id: "dev:api:web-1",
      include: ["messages"],
    });
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0]?.[0]).toContain("## Assistant\n\nhi there");
  });

  it("starts a pending clipboard write inside the click when the browser supports it", async () => {
    // Safari rejects a clipboard write that starts after an await; handing it
    // a ClipboardItem whose content is still loading keeps the gesture.
    const s = source(history("dev:api:web-1", chat));
    let item: FakeClipboardItem | undefined;
    const write = vi.fn(async (items: unknown[]) => {
      item = items[0] as FakeClipboardItem;
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    const pending = copyConversationMarkdown(
      s.source,
      { write, writeText },
      FakeClipboardItem as unknown as typeof ClipboardItem,
    );
    // Called synchronously, before the history has been read.
    expect(write).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBe("copied");
    const blob = await item?.items["text/plain"];
    expect(await blob?.text()).toContain("## User\n\nhello");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to text when the rich clipboard write is refused", async () => {
    const s = source(history("dev:api:web-1", chat));
    const write = vi.fn(async () => {
      throw new DOMException("not allowed", "NotAllowedError");
    });
    const writeText = vi.fn(async (_text: string) => undefined);
    await expect(
      copyConversationMarkdown(
        s.source,
        { write, writeText },
        FakeClipboardItem as unknown as typeof ClipboardItem,
      ),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledOnce();
  });

  it("reports an empty conversation without writing anything", async () => {
    const s = source(
      history("dev:api:web-1", [{ role: "tool", content: "tool only" }]),
    );
    const writeText = vi.fn(async (_text: string) => undefined);
    await expect(
      copyConversationMarkdown(s.source, { writeText }),
    ).resolves.toBe("empty");
    expect(writeText).not.toHaveBeenCalled();

    const write = vi.fn(async (items: unknown[]) => {
      await (items[0] as FakeClipboardItem).items["text/plain"];
    });
    await expect(
      copyConversationMarkdown(
        s.source,
        { write, writeText },
        FakeClipboardItem as unknown as typeof ClipboardItem,
      ),
    ).resolves.toBe("empty");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("refuses history that belongs to another Session", async () => {
    const s = source(history("dev:api:web-OTHER", chat));
    const writeText = vi.fn(async (_text: string) => undefined);
    await expect(
      copyConversationMarkdown(s.source, { writeText }),
    ).rejects.toThrow(/another Session/);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("surfaces a failed history read", async () => {
    const s = source(new Error("session/hydrate failed"));
    await expect(
      copyConversationMarkdown(s.source, { writeText: vi.fn() }),
    ).rejects.toThrow("session/hydrate failed");
  });
});
