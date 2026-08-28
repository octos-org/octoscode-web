import {
  CORE_UI_FEATURES,
  CORE_UI_METHODS,
  supportsFeature,
  supportsMethod,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";

const CODING_SESSION_METHODS = [
  CORE_UI_METHODS.SESSION_OPEN,
  CORE_UI_METHODS.SESSION_HYDRATE,
  CORE_UI_METHODS.TURN_START,
] as const;

const DURABLE_SESSION_FEATURES = [
  CORE_UI_FEATURES.SESSION_HYDRATE_V1,
  CORE_UI_FEATURES.PROJECTION_ENVELOPE_V2,
] as const;

export interface CodingProductCapabilities {
  sessionCreationAvailable: boolean;
  turnStartAvailable: boolean;
  turnInterruptAvailable: boolean;
  runtimeStatusAvailable: boolean;
}

/** Product-facing projection of the independently advertised coding methods. */
export function codingProductCapabilities(
  capabilities: UiProtocolCapabilities | undefined,
): CodingProductCapabilities {
  return {
    sessionCreationAvailable:
      missingCodingSessionRequirements(capabilities).length === 0 &&
      supportsMethod(capabilities, CORE_UI_METHODS.SESSION_LIST),
    turnStartAvailable: supportsMethod(
      capabilities,
      CORE_UI_METHODS.TURN_START,
    ),
    turnInterruptAvailable: supportsMethod(
      capabilities,
      CORE_UI_METHODS.TURN_INTERRUPT,
    ),
    runtimeStatusAvailable: supportsMethod(
      capabilities,
      CORE_UI_METHODS.SESSION_STATUS_READ,
    ),
  };
}

/**
 * A candidate cannot become the active coding Session unless every method and
 * durable projection feature needed by the composer is advertised.
 */
export function missingCodingSessionRequirements(
  capabilities: UiProtocolCapabilities | undefined,
): string[] {
  return [
    ...CODING_SESSION_METHODS.filter(
      (method) => !supportsMethod(capabilities, method),
    ),
    ...DURABLE_SESSION_FEATURES.filter(
      (feature) => !supportsFeature(capabilities, feature),
    ),
  ];
}
