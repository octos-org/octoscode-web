import type { TurnMedia } from "@octos-org/octoscode-client/protocol";
import {
  STEERING_ACCEPTED,
  type TimelineEntry,
} from "../timeline/entry-model.ts";

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
 * input it received, in order, with their files. Core gives the model a steer
 * before it echoes the steer as a user row, so until then the accepted notice
 * is the only record of it.
 */
export function latestReadOnlyDenial(
  entries: readonly TimelineEntry[],
): ReadOnlyDenial | null {
  const latest = entries.findLastIndex((entry) => entry.kind === "user");
  if (latest < 0) return null;
  const turnId = entries[latest]!.turnId;
  // An old transcript row can lack a turn; then it speaks only for itself.
  const first = turnId
    ? entries.findIndex(
        (entry) => entry.kind === "user" && entry.turnId === turnId,
      )
    : latest;
  const request = entries
    .slice(first)
    .filter(
      (entry) => !turnId || entry.turnId === turnId || isAcceptedSteer(entry),
    );
  const denied = request.find(
    (entry) =>
      entry.kind === "tool" &&
      entry.turnId &&
      entry.status === "error" &&
      READ_ONLY_DENIAL.test(entry.body),
  );
  const inputs = request.filter(
    (entry) => entry.kind === "user" || isAcceptedSteer(entry),
  );
  const texts = inputs.map((entry) => entry.body.trim()).filter(Boolean);
  if (!denied?.turnId || !texts.length) return null;
  return {
    turnId: denied.turnId,
    // A steer's notice and its later echo say the same thing.
    prompt: [...new Set(texts)].join("\n\n"),
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

function isAcceptedSteer(entry: TimelineEntry): boolean {
  return entry.kind === "system" && entry.title === STEERING_ACCEPTED;
}
