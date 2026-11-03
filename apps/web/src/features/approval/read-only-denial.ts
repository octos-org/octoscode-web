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
}

/**
 * The write the latest request lost to read-only access. A newer request
 * clears it, because that request may never need to write.
 */
export function latestReadOnlyDenial(
  entries: readonly TimelineEntry[],
): ReadOnlyDenial | null {
  let turnId: string | undefined;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.kind === "user") {
      return turnId && entry.body.trim()
        ? { turnId, prompt: entry.body }
        : null;
    }
    if (
      !turnId &&
      entry.kind === "tool" &&
      entry.turnId &&
      entry.status === "error" &&
      READ_ONLY_DENIAL.test(entry.body)
    )
      turnId = entry.turnId;
  }
  return null;
}
