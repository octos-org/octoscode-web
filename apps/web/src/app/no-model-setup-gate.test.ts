import { describe, expect, it } from "vitest";
import { shouldRouteNoModelSetup } from "../features/connection/no-model-setup.ts";

describe("§5.1 'No chat model is set up' routing gate (hotfix)", () => {
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
});
