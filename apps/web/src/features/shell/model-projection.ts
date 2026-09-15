import type { ProfileLlmModel } from "@octos-org/octoscode-client";
import type {
  ControlState,
  ModelProviderGroup,
  ModelSelection,
} from "../product-controls/types.ts";

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

function providerLabel(provider: string): string {
  return provider
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toLocaleUpperCase() + part.slice(1))
    .join(" ");
}
