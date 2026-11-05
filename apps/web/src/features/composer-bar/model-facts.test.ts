import { describe, expect, it } from "vitest";
import type {
  LlmCatalogResult,
  ProfileLlmConfigResult,
  ProfileLlmConfiguredModel,
} from "@octos-org/octoscode-client/protocol";
import { createUiText } from "../preferences/ui-text.tsx";
import { modelFactLabels, modelFacts } from "./model-facts.ts";

const catalog: LlmCatalogResult = {
  families: [
    {
      id: "deepseek",
      env: "DEEPSEEK_API_KEY",
      models: [
        {
          id: "deepseek-v4-pro",
          endpoints: [],
          context_window: 1_048_576,
          max_output: 8_192,
        },
        { id: "deepseek-v4-flash", endpoints: [] },
      ],
    },
  ],
};

function configured(
  patch: Partial<ProfileLlmConfiguredModel>,
): ProfileLlmConfiguredModel {
  return {
    family_id: "deepseek",
    model_id: "deepseek-v4-pro",
    route: { route_id: "official" },
    has_api_key: true,
    selected: true,
    available: true,
    ...patch,
  };
}

const config = (
  primary: ProfileLlmConfiguredModel | null,
  fallbacks: ProfileLlmConfiguredModel[] = [],
): ProfileLlmConfigResult => ({ profile_id: "p", primary, fallbacks });

const model = {
  model: "deepseek-v4-pro",
  provider: "deepseek",
  family: "deepseek",
  route: "official",
};

describe("model facts", () => {
  it("reads the catalog for the exact family and model", () => {
    expect(modelFacts(model, catalog, config(configured({})))).toEqual({
      contextWindow: 1_048_576,
      maxOutput: 8_192,
    });
  });

  it("lets the profile's configured window win, as Core does", () => {
    expect(
      modelFacts(
        model,
        catalog,
        config(configured({ context_window: 64_000 })),
      ),
    ).toEqual({ contextWindow: 64_000, maxOutput: 8_192 });
  });

  it("states images are stripped only when configured, never the opposite", () => {
    expect(
      modelFacts(
        model,
        catalog,
        config(configured({ model_hints: { lacks_vision: true } })),
      ).imagesStripped,
    ).toBe(true);
    for (const hints of [{ lacks_vision: false }, {}, null]) {
      expect(
        modelFacts(model, catalog, config(configured({ model_hints: hints }))),
      ).not.toHaveProperty("imagesStripped");
    }
  });

  it("never guesses from a name: an unlisted or look-alike model has no facts", () => {
    const empty = config(null);
    expect(
      modelFacts({ model: "gpt-5-mini", provider: "openai" }, catalog, empty),
    ).toEqual({});
    // The same model name under another family is not that catalog row.
    expect(
      modelFacts(
        { model: "deepseek-v4-pro", provider: "custom", family: "custom" },
        catalog,
        empty,
      ),
    ).toEqual({});
    // A catalog row without limits states none.
    expect(
      modelFacts(
        { model: "deepseek-v4-flash", provider: "deepseek" },
        catalog,
        empty,
      ),
    ).toEqual({});
  });

  it("keeps another route's configuration apart", () => {
    expect(
      modelFacts(
        model,
        null,
        config(
          configured({ route: { route_id: "other" }, context_window: 1000 }),
        ),
      ),
    ).toEqual({});
  });

  it("works from configuration alone when the server has no catalog", () => {
    expect(
      modelFacts(model, null, config(configured({ context_window: 64_000 }))),
    ).toEqual({ contextWindow: 64_000 });
  });

  it("words the facts plainly in both languages", () => {
    const facts = {
      contextWindow: 200_000,
      maxOutput: 8_192,
      imagesStripped: true as const,
    };
    expect(modelFactLabels(facts, createUiText("en"), "en-US")).toEqual([
      "200K token context",
      "8,192 token max output",
      "Images not sent",
    ]);
    expect(modelFactLabels({}, createUiText("en"), "en-US")).toEqual([]);
  });
});
