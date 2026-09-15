import type { UiProtocolCapabilities } from "@octos-org/octoscode-client/protocol";
import { EXTERNAL_DRIVER_METHODS, EXTERNAL_DRIVER_V1_FEATURE } from "@octos-org/octoscode-client/external-driver-meta";
import type { DriverInventoryState } from "./driver-discovery.ts";

export type SessionControlReadiness = "unavailable" | "ready";

export function deriveControlReadiness(input: {
  readonly capabilities: UiProtocolCapabilities | undefined;
  readonly driverInventory: DriverInventoryState;
}): SessionControlReadiness {
  const capabilities = input.capabilities;
  if (!capabilities) return "unavailable";
  const controlAdvertised = capabilities.supported_methods?.includes(
    EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
  );
  const driverAdvertised = capabilities.supported_features?.includes(
    EXTERNAL_DRIVER_V1_FEATURE,
  );
  if (!controlAdvertised || !driverAdvertised) return "unavailable";
  const observed = input.driverInventory;
  if (observed.kind !== "complete") return "unavailable";
  return "ready";
}
