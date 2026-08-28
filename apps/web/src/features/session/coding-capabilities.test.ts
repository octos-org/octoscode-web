import { describe, expect, it } from "vitest";
import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import {
  codingProductCapabilities,
  missingCodingSessionRequirements,
} from "./coding-capabilities.ts";

const baselineMethods = [
  CORE_UI_METHODS.SESSION_LIST,
  CORE_UI_METHODS.SESSION_OPEN,
  CORE_UI_METHODS.SESSION_HYDRATE,
  CORE_UI_METHODS.TURN_START,
];
const baselineFeatures = [
  CORE_UI_FEATURES.SESSION_HYDRATE_V1,
  CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
];

describe("coding product capabilities", () => {
  it("requires catalog, open, hydrate, turn start, and durable features before Session creation", () => {
    expect(
      codingProductCapabilities(capabilities(baselineMethods, baselineFeatures))
        .sessionCreationAvailable,
    ).toBe(true);

    for (const missing of [...baselineMethods, ...baselineFeatures]) {
      const methods = baselineMethods.filter((method) => method !== missing);
      const features = baselineFeatures.filter(
        (feature) => feature !== missing,
      );
      expect(
        codingProductCapabilities(capabilities(methods, features))
          .sessionCreationAvailable,
      ).toBe(false);
      if (missing !== CORE_UI_METHODS.SESSION_LIST) {
        expect(
          missingCodingSessionRequirements(capabilities(methods, features)),
        ).toContain(missing);
      }
    }
  });

  it("keeps interrupt and runtime status independent from the creation baseline", () => {
    const baseline = codingProductCapabilities(
      capabilities(baselineMethods, baselineFeatures),
    );
    expect(baseline).toMatchObject({
      sessionCreationAvailable: true,
      turnStartAvailable: true,
      turnInterruptAvailable: false,
      runtimeStatusAvailable: false,
    });

    const optional = codingProductCapabilities(
      capabilities(
        [
          ...baselineMethods,
          CORE_UI_METHODS.TURN_INTERRUPT,
          CORE_UI_METHODS.SESSION_STATUS_READ,
        ],
        baselineFeatures,
      ),
    );
    expect(optional).toMatchObject({
      turnInterruptAvailable: true,
      runtimeStatusAvailable: true,
    });
  });
});

function capabilities(
  methods: string[],
  features: string[],
): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: methods,
    supported_notifications: [],
    supported_features: features,
  };
}
