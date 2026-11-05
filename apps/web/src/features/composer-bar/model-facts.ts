import type {
  LlmCatalogResult,
  ProfileLlmConfigResult,
  ProfileLlmModel,
} from "@octos-org/octoscode-client/protocol";
import type { UiText } from "../preferences/ui-text.tsx";
import { formatTokenCount } from "./session-usage.ts";

/**
 * What the server can prove about a configured model. Nothing here comes from
 * the model's name: `profile/llm/catalog` gives the context window and maximum
 * output of the exact family and model, and the profile's own configuration
 * can override the window or say images are stripped. Core reports nothing
 * about tools or speed and never says a model can see images, so neither does
 * this page. Anything it does not report stays unstated.
 */
export interface ModelFacts {
  contextWindow?: number;
  maxOutput?: number;
  imagesStripped?: true;
}

export function modelFacts(
  model: Pick<ProfileLlmModel, "model" | "provider" | "family" | "route">,
  catalog: LlmCatalogResult | null,
  config: ProfileLlmConfigResult,
): ModelFacts {
  const family = model.family ?? model.provider;
  const listed = catalog?.families
    .find((entry) => entry.id === family)
    ?.models.find((entry) => entry.id === model.model);
  const configured = [
    ...(config.primary ? [config.primary] : []),
    ...config.fallbacks,
  ].find(
    (entry) =>
      entry.family_id === family &&
      entry.model_id === model.model &&
      (entry.route.route_id ?? "") === (model.route ?? ""),
  );
  // Core resolves the configured window ahead of the catalog's.
  const contextWindow = configured?.context_window ?? listed?.context_window;
  return {
    ...(contextWindow ? { contextWindow } : {}),
    ...(listed?.max_output ? { maxOutput: listed.max_output } : {}),
    ...(configured?.model_hints?.lacks_vision ? { imagesStripped: true } : {}),
  };
}

export function modelFactLabels(
  facts: ModelFacts,
  t: UiText,
  locale: string,
): string[] {
  return [
    ...(facts.contextWindow
      ? [
          t("{count} token context", {
            count: formatTokenCount(facts.contextWindow, locale),
          }),
        ]
      : []),
    ...(facts.maxOutput
      ? [
          t("{count} token max output", {
            count: formatTokenCount(facts.maxOutput, locale),
          }),
        ]
      : []),
    ...(facts.imagesStripped ? [t("Images not sent")] : []),
  ];
}
