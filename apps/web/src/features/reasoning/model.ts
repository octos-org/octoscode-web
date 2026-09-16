/** Core ReasoningEffortLevel, not provider identity or a token budget. */
export type ReasoningEffort = "low" | "medium" | "high" | "max";

export function reasoningEffort(value: unknown): ReasoningEffort | undefined {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "max"
    ? value
    : undefined;
}

export const REASONING_CHOICES = [
  { value: "", label: "Profile default" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "max", label: "Maximum" },
] as const;
