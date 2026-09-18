import { describe, expect, it } from "vitest";
import {
  shouldRouteNoModelSetup,
  type NoModelSetupInput,
} from "../features/connection/no-model-setup.ts";

/**
 * Hotfix (run 21): the §5.1 'No chat model is set up' routing must NEVER fire
 * on an unsettled fetch. The mock's actual profile/llm/list (verified
 * apps/web/scripts/mock-ui-server.mjs:2870) requires a session_id and returns
 * { session_id, models: sessionModel[] } with glm-5.3-flash selected+available;
 * pre-session the hook's refresh() early-returns, leaving available:true +
 * models:[] — indistinguishable from empty unless a SETTLED flag exists.
 */
const MOCK_LISTED_SHAPE: NoModelSetupInput = {
  available: true,
  loading: false,
  models: [
    {
      model: "glm-5.3-flash",
      provider: "zai",
      title: "GLM 5.3 Flash",
      family: "zai",
      route: "official",
      selected: true,
      available: true,
    },
    {
      model: "deepseek-v4-pro",
      provider: "deepseek",
      title: "DeepSeek V4 Pro",
      family: "deepseek",
      route: "official",
      selected: false,
      available: true,
    },
  ],
};

describe("§5.1 'No chat model is set up' routing gate (hotfix)", () => {
  it("does NOT route when the list is loaded and healthy (the mock's shape)", () => {
    expect(shouldRouteNoModelSetup(MOCK_LISTED_SHAPE)).toBe(false);
  });

  it("does NOT route while the fetch is in flight", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: true,
        models: [],
        fetched: false,
      }),
    ).toBe(false);
  });

  it("does NOT route when the method was never advertised", () => {
    expect(
      shouldRouteNoModelSetup({
        available: false,
        loading: false,
        models: [],
      }),
    ).toBe(false);
  });

  it("does NOT route pre-session: advertised but never fetched (run 21 defect)", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: false,
        models: [],
        fetched: false,
      }),
    ).toBe(false);
  });

  it("routes ONLY on a settled, fetched, empty list", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: false,
        models: [],
        fetched: true,
      }),
    ).toBe(true);
  });

  it("routes when the settled list has no usable (available+selected) primary", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: false,
        models: [
          {
            model: "x",
            provider: "x",
            title: "X",
            family: "x",
            route: "official",
            selected: true,
            available: false,
          },
        ],
        fetched: true,
      }),
    ).toBe(true);
  });
});
