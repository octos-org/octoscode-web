import type { ProfileLlmConfiguredModel } from "@octos-org/octoscode-client";
import type {
  ModelSettingsDraft,
  ModelSettingsState,
} from "../models/model-settings.ts";
import type {
  ConfiguredModelProvider,
  ModelApiProtocolOption,
  ModelCatalogSuggestion,
  ModelManagementState,
  ModelProviderDraft,
  ModelProviderFamilyOption,
  ModelProviderRoute,
} from "./ModelManagementSection.tsx";

export interface ModelManagementProjection {
  state: ModelManagementState;
  providers: ConfiguredModelProvider[];
  families: ModelProviderFamilyOption[];
  apiProtocols: ModelApiProtocolOption[];
}

/** Projects the bounded, secret-free Core contract into the DSH-style view. */
export function projectModelManagement(
  source: ModelSettingsState,
): ModelManagementProjection {
  const families = source.catalog?.families.map(projectFamily) ?? [];
  const configured = source.configuration
    ? [
        ...(source.configuration.primary ? [source.configuration.primary] : []),
        ...source.configuration.fallbacks,
      ]
    : [];
  const providers = configured.map((model) =>
    projectConfiguredModel(model, families),
  );

  const protocols = new Set<string>(["openai"]);
  for (const family of families) {
    for (const model of family.models) {
      if (model.route?.apiProtocol) protocols.add(model.route.apiProtocol);
    }
  }
  for (const provider of providers) {
    if (provider.route.apiProtocol) protocols.add(provider.route.apiProtocol);
  }

  const configurationKnown = source.configuration !== null;
  const state: ModelManagementState = !source.capabilities.read
    ? {
        status: "unavailable",
        message:
          "This Octos server cannot report the active Profile’s configured providers.",
      }
    : source.phase === "loading" && !configurationKnown
      ? { status: "loading" }
      : !configurationKnown
        ? {
            status: "error",
            message:
              source.error ??
              "Could not load the active Profile’s configured providers.",
          }
        : { status: "ready" };

  return {
    state,
    providers,
    families,
    apiProtocols: [...protocols].map((id) => ({
      id,
      label: protocolLabel(id),
    })),
  };
}

export function modelSettingsDraftFromProvider(
  draft: ModelProviderDraft,
  setPrimary: boolean,
): ModelSettingsDraft {
  return {
    familyId: draft.familyId,
    modelId: draft.modelId,
    route: {
      routeId: draft.route.id,
      label: draft.route.label,
      baseUrl: draft.route.baseUrl,
      apiKeyEnv: draft.route.apiKeyEnv,
      apiType: draft.route.apiProtocol,
    },
    setPrimary,
  };
}

export function modelSettingsDeleteTarget(
  provider: ConfiguredModelProvider,
): Pick<ModelSettingsDraft, "familyId" | "modelId" | "route"> {
  return modelSettingsDraftFromProvider(
    {
      familyId: provider.familyId,
      modelId: provider.modelId,
      route: provider.route,
      apiKey: "",
    },
    false,
  );
}

function projectFamily(
  family: NonNullable<ModelSettingsState["catalog"]>["families"][number],
): ModelProviderFamilyOption {
  const suggestions: ModelCatalogSuggestion[] = family.models.map((model) => {
    const endpoint = model.endpoints[0];
    return {
      id: model.id,
      label: modelLabel(model.id),
      ...(endpoint
        ? {
            route: {
              id: endpoint.id,
              label: endpoint.label || routeLabel(endpoint.id),
              baseUrl: endpoint.base_url ?? "",
              apiProtocol: endpoint.api_type ?? "openai",
              apiKeyEnv: endpoint.api_key_env ?? family.env,
            },
          }
        : {}),
    };
  });
  const defaultRoute = suggestions.find((model) => model.route)?.route;
  return {
    id: family.id,
    label: familyLabel(family.id),
    models: suggestions,
    ...(defaultRoute ? { defaultRoute } : {}),
    credentialRequirement: family.env ? "required" : "none",
    requiresBaseUrl: false,
  };
}

function projectConfiguredModel(
  model: ProfileLlmConfiguredModel,
  families: readonly ModelProviderFamilyOption[],
): ConfiguredModelProvider {
  const family = families.find((candidate) => candidate.id === model.family_id);
  const routeId = model.route.route_id?.trim() ?? "";
  const apiProtocol = model.route.api_type?.trim() ?? "";
  const mutationSafe = Boolean(routeId && apiProtocol);
  const route: ModelProviderRoute = {
    id: routeId,
    label:
      model.route.label ||
      (routeId ? routeLabel(routeId) : "Route identity unavailable"),
    baseUrl: model.route.base_url ?? "",
    apiProtocol,
    apiKeyEnv: model.route.api_key_env ?? "",
  };
  return {
    id: [model.family_id, model.model_id, routeId || "unresolved-route"].join(
      ":",
    ),
    familyId: model.family_id,
    familyLabel: family?.label ?? familyLabel(model.family_id),
    modelId: model.model_id,
    modelLabel: modelLabel(model.model_id),
    route,
    apiKeyConfigured: model.has_api_key,
    primary: model.selected,
    editable: model.available && mutationSafe,
    removable: mutationSafe,
    ...(!mutationSafe
      ? {
          mutationUnavailableReason:
            "Core did not report a complete route identity. This entry is read-only.",
        }
      : {}),
  };
}

function familyLabel(id: string): string {
  const known: Record<string, string> = {
    zai: "Z.AI",
    "zai-coding": "Z.AI Coding Plan",
    deepseek: "DeepSeek",
    ollama: "Ollama",
    openai: "OpenAI",
    anthropic: "Anthropic",
  };
  return known[id] ?? titleCase(id);
}

function modelLabel(id: string): string {
  if (id === "glm-5.3-flash") return "GLM-5.3-Flash";
  return id
    .split("-")
    .map((part) => {
      if (/^glm$/i.test(part)) return "GLM";
      if (/^\d+(?:\.\d+)*$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function routeLabel(id: string): string {
  return id === "official" ? "Official" : titleCase(id);
}

function protocolLabel(id: string): string {
  if (id === "openai") return "OpenAI-compatible";
  if (id === "anthropic") return "Anthropic-compatible";
  return titleCase(id);
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
