import type { TurnMedia } from "@octos-org/octoscode-client/protocol";
import type { TimelineEntry } from "../timeline/entry-model.ts";

/**
 * How Core words a write blocked by read-only access: its own tools say
 * "read-only filesystem access", and a shell command the sandbox stops says
 * "Read-only file system" or carries its "[sandbox]" hint.
 */
const READ_ONLY_DENIAL = /read-only|read_only|\[sandbox\]/i;

export interface ReadOnlyDenial {
  turnId: string;
  /** The request that lost the write, to run again once it can write. */
  prompt: string;
  /** The files that request was sent with. */
  media: TurnMedia[];
}

/**
 * The write the latest request lost to read-only access. A newer request
 * clears it, because that request may never need to write. A steer is not a
 * newer request: it joins the running turn, so redoing the turn takes every
 * input it received, in order, with their files.
 */
export function latestReadOnlyDenial(
  entries: readonly TimelineEntry[],
): ReadOnlyDenial | null {
  const latest = entries.findLastIndex((entry) => entry.kind === "user");
  if (latest < 0) return null;
  const turnId = entries[latest]!.turnId;
  // An old transcript row can lack a turn; then it speaks only for itself.
  const request = turnId
    ? entries.filter((entry) => entry.turnId === turnId)
    : entries.slice(latest);
  const denied = request.find(
    (entry) =>
      entry.kind === "tool" &&
      entry.turnId &&
      entry.status === "error" &&
      READ_ONLY_DENIAL.test(entry.body),
  );
  const inputs = request.filter((entry) => entry.kind === "user");
  const prompt = inputs
    .map((entry) => entry.body.trim())
    .filter(Boolean)
    .join("\n\n");
  if (!denied?.turnId || !prompt) return null;
  return {
    turnId: denied.turnId,
    prompt,
    media: inputs.flatMap((entry) =>
      (entry.media ?? []).map((path) => ({
        path,
        // Core goes by the path; the timeline does not keep the type.
        mime: "application/octet-stream",
        size_bytes: entry.attachmentSizes?.[path] ?? 0,
      })),
    ),
  };
}
