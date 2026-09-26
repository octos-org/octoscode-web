import type {
  SessionHydrateParams,
  SessionHydrateResult,
} from "@octos-org/octoscode-client/protocol";
import { conversationMarkdown } from "./conversation-markdown.ts";

export interface ConversationCopySource {
  client: {
    hydrateSession(params: SessionHydrateParams): Promise<SessionHydrateResult>;
  };
  sessionId: string;
  workspaceRoot?: string | undefined;
  title?: string | undefined;
}

/** The slice of `navigator.clipboard` this uses (`write` is optional). */
export interface ConversationClipboard {
  write?(items: ClipboardItem[]): Promise<void>;
  writeText(text: string): Promise<void>;
}

class EmptyConversation extends Error {}

/**
 * Copy a Session's conversation as Markdown, read from the server's canonical
 * history (the same read-only `session/hydrate` the history viewer uses).
 *
 * Call it directly from the click handler. Where the browser supports it the
 * clipboard write STARTS synchronously with a still-loading `ClipboardItem`,
 * because Safari refuses a clipboard write that begins after an await; the
 * text path is the fallback.
 */
export async function copyConversationMarkdown(
  source: ConversationCopySource,
  clipboard: ConversationClipboard,
  ClipboardItemCtor:
    typeof ClipboardItem | undefined = globalThis.ClipboardItem,
): Promise<"copied" | "empty"> {
  const markdown = readConversationMarkdown(source);
  if (clipboard.write && ClipboardItemCtor) {
    const blob = markdown.then((text) => {
      if (!text) throw new EmptyConversation();
      return new Blob([text], { type: "text/plain" });
    });
    try {
      await clipboard.write([new ClipboardItemCtor({ "text/plain": blob })]);
      return "copied";
    } catch {
      // A failed history read or an empty conversation is reported below;
      // anything else was the rich write itself, so retry as plain text.
    }
  }
  const text = await markdown;
  if (!text) return "empty";
  await clipboard.writeText(text);
  return "copied";
}

async function readConversationMarkdown(
  source: ConversationCopySource,
): Promise<string> {
  const history = await source.client.hydrateSession({
    session_id: source.sessionId,
    include: ["messages"],
  });
  if (history.session_id !== source.sessionId)
    throw new Error("History belongs to another Session.");
  return conversationMarkdown({
    sessionId: source.sessionId,
    workspaceRoot: source.workspaceRoot,
    title: source.title,
    messages: history.messages ?? [],
  });
}
