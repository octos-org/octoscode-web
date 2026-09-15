export function formatRelativeTime(
  timestamp: string | number | undefined,
  now = Date.now(),
): string | undefined {
  const value =
    typeof timestamp === "number" ? timestamp : Date.parse(timestamp ?? "");
  if (!Number.isFinite(value)) return undefined;
  const elapsed = Math.max(0, now - value);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  if (elapsed < 604_800_000) return `${Math.floor(elapsed / 86_400_000)}d`;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(value);
}
