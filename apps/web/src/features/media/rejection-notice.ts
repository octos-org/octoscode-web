import type { UiText } from "../preferences/ui-text.tsx";
import type {
  AttachmentRejection,
  RejectedAttachment,
} from "./attachment-drafts.ts";

const MESSAGE: Readonly<Record<AttachmentRejection, string>> = {
  office:
    "Office files aren't supported: {names}. Save them as PDF or CSV and attach those.",
  unsupported:
    "This file type can't be attached: {names}. Use CSV, Markdown, text, PDF or images.",
  empty: "These files are empty: {names}.",
  "too-large":
    "Too large to attach: {names}. Files can be up to 50 MiB and images up to 20 MiB.",
  "too-many":
    "Not attached, because one message holds 10 files and 4 images at most: {names}.",
};

/** One sentence per reason, naming the files so nothing is dropped silently. */
export function attachmentRejectionNotice(
  rejected: readonly RejectedAttachment[],
  t: UiText,
): string | null {
  const sentences = (Object.keys(MESSAGE) as AttachmentRejection[]).flatMap(
    (reason) => {
      const names = rejected
        .filter((item) => item.reason === reason)
        .map((item) => item.name);
      return names.length
        ? [t(MESSAGE[reason], { names: names.join(t(", ")) })]
        : [];
    },
  );
  return sentences.length ? sentences.join(" ") : null;
}
