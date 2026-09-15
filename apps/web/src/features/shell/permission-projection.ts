import type {
  PermissionNetworkPolicy,
  PermissionProfileListResult,
  PermissionProfileMode,
} from "@octos-org/octoscode-client";
import type {
  ControlState,
  SessionPermissionOption,
} from "../product-controls/types.ts";

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
