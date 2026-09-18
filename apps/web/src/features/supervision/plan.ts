import type {
  PlanItem,
  PlanItemStatus,
  PlanUpdated,
} from "@octos-org/octoscode-client/protocol";

/**
 * Plan/todo checklist rules, kept pure so the card stays presentation only.
 *
 * Core's `update_plan` tool sends the FULL ordered list on every call, so a
 * `plan/updated` REPLACES any prior plan wholesale — never a diff. A plan is
 * scoped to the turn that authored it (when the server knows one) and is
 * dropped when that turn terminates; a plan with no authoring turn has no
 * terminal event to key removal on, so it survives until the next replacement.
 * This mirrors octoscode's `set_session_plan` / `clear_session_plan_for_turn`.
 */

/** Wholesale replacement. `available` is the `plan.todos.v1` gate: an
 *  unadvertised feature keeps the state empty rather than trusting the wire. */
export function applyPlanUpdated(
  current: PlanUpdated | null,
  event: PlanUpdated,
  available: boolean,
): PlanUpdated | null {
  return available ? event : current;
}

/** Drop the checklist once its authoring turn terminates (completed, errored
 *  or interrupted). Turn-matched so a replayed terminal for an older turn
 *  cannot clear a newer plan. */
export function clearPlanForTurn(
  current: PlanUpdated | null,
  turnId: string,
): PlanUpdated | null {
  return current?.turnId === turnId ? null : current;
}

export interface PlanProgress {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
}

export function planProgress(items: readonly PlanItem[]): PlanProgress {
  return {
    total: items.length,
    completed: items.filter((item) => item.status === "completed").length,
    inProgress: items.filter((item) => item.status === "in_progress").length,
    pending: items.filter((item) => item.status === "pending").length,
  };
}

/**
 * The header line. The server's own title wins; otherwise the in-progress item
 * names what is happening now. Both are MODEL prose and must never be
 * translated — `null` means the card falls back to its own localized label.
 */
export function planHeadline(plan: PlanUpdated): string | null {
  const title = plan.title?.trim();
  if (title) return title;
  const active = plan.items.find((item) => item.status === "in_progress");
  return active?.title.trim() || null;
}

/** English source text for a status, for `useUiText` to translate. */
export function planStatusLabel(status: PlanItemStatus): string {
  switch (status) {
    case "completed":
      return "Done";
    case "in_progress":
      return "In progress";
    case "pending":
      return "Pending";
  }
}

/** A quiet, glanceable "updated" time. Sub-minute ages read as "just now" so
 *  a fast-moving plan does not flicker a new number on every replacement. */
export function planUpdatedLabel(
  updatedAtMs: number,
  nowMs: number,
): { source: string; params?: Record<string, number> } {
  const elapsedMs = nowMs - updatedAtMs;
  if (!Number.isFinite(elapsedMs) || elapsedMs < 60_000) {
    return { source: "Updated just now" };
  }
  const minutes = Math.floor(elapsedMs / 60_000);
  if (minutes < 60)
    return { source: "Updated {count}m ago", params: { count: minutes } };
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return { source: "Updated {count}h ago", params: { count: hours } };
  return {
    source: "Updated {count}d ago",
    params: { count: Math.floor(hours / 24) },
  };
}

/** Fail closed: no advertised feature, no plan, or an empty checklist — no card. */
export function planCardVisible(
  plan: PlanUpdated | null,
  available: boolean,
): plan is PlanUpdated {
  return available && plan !== null && plan.items.length > 0;
}
