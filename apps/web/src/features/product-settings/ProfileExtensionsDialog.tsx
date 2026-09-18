import type { ComponentProps } from "react";
import { SkillsDialog } from "../skills/SkillsDialog.tsx";
import { ResearchDialog } from "../research/ResearchDialog.tsx";

/** Deferred Profile settings surfaces share scope/locks, not runtime state. */
export function ProfileExtensionsDialog({
  mode,
  ...props
}: ComponentProps<typeof SkillsDialog> & { mode: "skills" | "research" }) {
  return mode === "skills" ? (
    <SkillsDialog {...props} />
  ) : (
    <ResearchDialog {...props} />
  );
}
