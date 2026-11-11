import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";

/**
 * Shared UiProtocolCapabilities fixture builder (T-0591 S3).
 *
 * Six apps/web test files each hand-wrote the same AppUI capabilities
 * literal; this helper centralizes the two field families so a protocol
 * drift is edited once.
 */
export function appuiCaps(init: {
  methods?: string[];
  features?: string[];
  notifications?: string[];
}): UiProtocolCapabilities {
  return {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: init.methods ?? [],
    supported_notifications: init.notifications ?? [],
    supported_features: init.features ?? [],
  };
}
