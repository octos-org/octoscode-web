import type {
  PermissionNetworkPolicy,
  PermissionProfileListResult,
  PermissionProfileMode,
  ProfileLlmModel,
} from "@octos-org/octoscode-client";
import type {
  ControlState,
  SessionPermissionOption,
} from "../product-controls/index.ts";

export function permissionControlState(input: {
  available: boolean;
  loading: boolean;
  error: string | null;
  result: PermissionProfileListResult | null;
}): ControlState {
  if (!input.available) return { status: "unavailable" };
  if (input.loading && !input.result) return { status: "loading" };
  if (input.error) return { status: "error", message: input.error };
  return { status: "ready" };
}

export function permissionOptionId(
  mode: PermissionProfileMode,
  network: PermissionNetworkPolicy,
): string {
  return `${mode}:${network}`;
}

export function permissionOptions(
  result: PermissionProfileListResult | null,
): SessionPermissionOption[] {
  if (!result) return [];
  const selections = [
    result.current,
    ...result.profiles.filter(
      (profile) =>
        profile.mode !== result.current.mode ||
        profile.network !== result.current.network,
    ),
  ];
  return selections.map((selection) => ({
    id: permissionOptionId(selection.mode, selection.network),
    mode: selection.mode,
    network: selection.network,
    modeLabel: permissionModeLabel(selection.mode),
    networkLabel: permissionNetworkLabel(selection.network),
    risk: selection.mode === "danger_full_access" ? "dangerous" : "standard",
  }));
}

export function profileDefaultNeedsRestart(
  runtimeModel: { model: string; provider: string } | null | undefined,
  models: readonly ProfileLlmModel[],
  serverHint: boolean,
): boolean {
  const profileDefault = models.find((model) => model.selected);
  if (!runtimeModel || !profileDefault) return serverHint;
  // Session status exposes provider/model but not Core's route or policy
  // revision. Equal strings therefore cannot disprove an authoritative
  // restart_required response after a route-only policy change.
  return (
    serverHint ||
    runtimeModel.provider !== profileDefault.provider ||
    runtimeModel.model !== profileDefault.model
  );
}

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

function permissionModeLabel(mode: PermissionProfileMode): string {
  switch (mode) {
    case "read_only":
      return "Read";
    case "workspace_write":
      return "Write";
    case "danger_full_access":
      return "Full access";
  }
}

function permissionNetworkLabel(network: PermissionNetworkPolicy): string {
  return network === "allow" ? "Network allowed" : "Network blocked";
}

export {
  findModel,
  modelControlState,
  modelGroups,
  modelOptionId,
  selectedModel,
} from "./model-projection.ts";
