import type { UiProtocolCapabilities } from "../../src/types.ts";

/**
 * Shared UiProtocolCapabilities fixture builder (T-0588 C9).
 *
 * Two protocol families appear across the client tests: the AppUI family
 * (`octos-ui/v1alpha1`, schema_version 2) and the external-driver family
 * (`octos/ui-protocol`, schema_version 1). Each test file previously built
 * an identical literal by hand; this helper centralizes the two shapes so
 * a schema drift is edited once.
 *
 * Usage:
 *   makeCaps({ methods: [...], features: [...] })            // AppUI family
 *   makeCaps({ family: "driver", methods: [...], features: [...] })
 */
export function makeCaps(
  init: {
    family?: "appui" | "driver";
    methods?: string[];
    features?: string[];
    notifications?: string[];
  } = {},
): UiProtocolCapabilities {
  const driver = init.family === "driver";
  return {
    version: {
      protocol: driver ? "octos/ui-protocol" : "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: driver ? 1 : 2,
    supported_methods: init.methods ?? [],
    supported_notifications: init.notifications ?? [],
    ...(init.features !== undefined
      ? { supported_features: init.features }
      : {}),
  };
}
