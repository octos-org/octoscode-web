import type { HydratedMessage } from "@octos-org/octoscode-client/protocol";

/**
 * Markdown for a conversation, built from the server's canonical history
 * (`session/hydrate` messages) rather than the rendered timeline, which keeps
 * only a bounded window of recent entries.
 *
 * It is the chat, for pasting into another tool as context: user and
 * assistant text only. Tool output, hidden reasoning and system rows are left
 * out, and consecutive messages from one speaker (an agent turn is many
 * assistant rows around tool calls) become one section.
 */
export interface ConversationMarkdownInput {
  sessionId: string;
  workspaceRoot?: string | undefined;
  title?: string | undefined;
  messages: readonly HydratedMessage[];
}

type Speaker = "user" | "assistant";

const HEADINGS: Record<Speaker, string> = {
  user: "## User",
  assistant: "## Assistant",
};

/** Empty string when there is no chat text to copy. */
export function conversationMarkdown(input: ConversationMarkdownInput): string {
  const sections: { speaker: Speaker; parts: string[] }[] = [];
  for (const message of input.messages) {
    const speaker = speakerOf(message.role);
    const text = trimBlankLines(message.content);
    if (!speaker || !text) continue;
    const last = sections.at(-1);
    if (last?.speaker === speaker) last.parts.push(text);
    else sections.push({ speaker, parts: [text] });
  }
  if (sections.length === 0) return "";

  const lines = [`# ${heading(input)}`, ""];
  if (input.workspaceRoot)
    lines.push(`- Workspace: \`${input.workspaceRoot}\``);
  lines.push(`- Session: \`${input.sessionId}\``, "");
  const gap = historyGap(input.messages);
  if (gap) lines.push(gap, "");
  for (const section of sections) {
    lines.push(HEADINGS[section.speaker], "", section.parts.join("\n\n"), "");
  }
  return lines.join("\n");
}

function speakerOf(role: string): Speaker | null {
  const normalized = role.trim().toLowerCase();
  return normalized === "user" || normalized === "assistant"
    ? normalized
    : null;
}

/** Drop leading/trailing blank lines but keep indentation (code blocks). */
function trimBlankLines(text: string): string {
  return text
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "")
    .trimEnd();
}

function heading(input: ConversationMarkdownInput): string {
  const title = input.title?.trim();
  if (title) return title;
  const leaf = input.workspaceRoot
    ?.replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1);
  return leaf || "Conversation";
}

/**
 * The server may return a long session's history with rows left out (it
 * loads within a budget). Every row, tool rows included, carries a canonical
 * `seq`, so fewer rows than the span they cover means some are missing; say
 * so rather than hand over a transcript that looks whole.
 */
function historyGap(messages: readonly HydratedMessage[]): string | null {
  const first = messages.at(0)?.seq;
  const last = messages.at(-1)?.seq;
  if (first === undefined || last === undefined) return null;
  if (messages.length >= last - first + 1) return null;
  return `> Incomplete: the server returned ${messages.length} messages spanning seq ${first}–${last}; the missing ones are not included.`;
}
