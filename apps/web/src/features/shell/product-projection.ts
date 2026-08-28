import type {
  PermissionNetworkPolicy,
  PermissionProfileListResult,
  PermissionProfileMode,
  ProfileLlmModel,
} from "@octos-org/octoscode-client";
import type {
  ControlState,
  ModelProviderGroup,
  ModelSelection,
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

export function modelControlState(input: {
  available: boolean;
  loading: boolean;
  error: string | null;
  models: readonly ProfileLlmModel[];
}): ControlState {
  if (!input.available) return { status: "unavailable" };
  if (input.loading && input.models.length === 0) return { status: "loading" };
  if (input.error) return { status: "error", message: input.error };
  return { status: "ready" };
}

export function modelOptionId(model: ProfileLlmModel): string {
  return `${model.model}:${model.route ?? "default"}`;
}

export function modelGroups(
  models: readonly ProfileLlmModel[],
): ModelProviderGroup[] {
  const groups = new Map<string, ProfileLlmModel[]>();
  for (const model of models) {
    const current = groups.get(model.provider) ?? [];
    current.push(model);
    groups.set(model.provider, current);
  }
  return [...groups.entries()].map(([provider, entries]) => ({
    id: provider,
    name: providerLabel(provider),
    models: entries.map((model) => ({
      id: modelOptionId(model),
      name: model.title || model.model,
      ...(model.title && model.title !== model.model
        ? { description: model.model }
        : {}),
      available: model.available,
      ...(!model.available
        ? { unavailableReason: "This configured model is unavailable." }
        : {}),
    })),
  }));
}

export function selectedModel(
  models: readonly ProfileLlmModel[],
): ModelSelection | null {
  const selected = models.find((model) => model.selected);
  return selected
    ? { providerId: selected.provider, modelId: modelOptionId(selected) }
    : null;
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

export function findModel(
  models: readonly ProfileLlmModel[],
  selection: ModelSelection,
): ProfileLlmModel | null {
  return (
    models.find(
      (model) =>
        model.provider === selection.providerId &&
        modelOptionId(model) === selection.modelId,
    ) ?? null
  );
}

export function formatRelativeTime(
  timestamp: string | undefined,
  now = Date.now(),
): string | undefined {
  const value = Date.parse(timestamp ?? "");
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

function providerLabel(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
