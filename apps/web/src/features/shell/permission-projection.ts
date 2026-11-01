import type {
  PermissionNetworkPolicy,
  PermissionProfileListResult,
  PermissionProfileMode,
  PermissionProfileSelection,
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

const MODES: readonly PermissionProfileMode[] = [
  "read_only",
  "workspace_write",
  "danger_full_access",
];
const NETWORKS: readonly PermissionNetworkPolicy[] = ["allow", "deny"];

export function permissionOptions(
  result: PermissionProfileListResult | null,
  defaultSelection?: PermissionProfileSelection | undefined,
): SessionPermissionOption[] {
  if (!result) return [];
  const advertised = [result.current, ...result.profiles];
  const modes = MODES.filter((mode) =>
    advertised.some((profile) => profile.mode === mode),
  );
  const networks = NETWORKS.filter((network) =>
    advertised.some((profile) => profile.network === network),
  );
  const selections = modes.flatMap((mode) =>
    networks.map((network) => ({ mode, network })),
  );
  selections.sort((left, right) => {
    const leftDefault = sameSelection(left, defaultSelection) ? 1 : 0;
    const rightDefault = sameSelection(right, defaultSelection) ? 1 : 0;
    return rightDefault - leftDefault;
  });
  return selections.map((selection) => ({
    id: permissionOptionId(selection.mode, selection.network),
    mode: selection.mode,
    network: selection.network,
    modeLabel: permissionModeLabel(selection.mode),
    networkLabel: permissionNetworkLabel(selection.network),
    description: permissionDescription(selection.mode, selection.network),
    isDefault: sameSelection(selection, defaultSelection),
    risk: selection.mode === "danger_full_access" ? "dangerous" : "standard",
  }));
}

function sameSelection(
  selection: PermissionProfileSelection,
  other: PermissionProfileSelection | undefined,
): boolean {
  return selection.mode === other?.mode && selection.network === other.network;
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

function permissionDescription(
  mode: PermissionProfileMode,
  network: PermissionNetworkPolicy,
): string {
  const networkCopy =
    network === "allow" ? "Network allowed." : "No network access.";
  switch (mode) {
    case "read_only":
      return `Read files without editing. ${networkCopy}`;
    case "workspace_write":
      return `Edit workspace files. ${networkCopy}`;
    case "danger_full_access":
      return `Edit any file without sandbox limits. ${networkCopy}`;
  }
}
