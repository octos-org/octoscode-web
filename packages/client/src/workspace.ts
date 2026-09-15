import { isRecord } from "./rpc.ts";
import { isNonNegativeInteger, isStringArray } from "./wire-decoders.ts";
import type { ConfigCapabilitiesListResult } from "./types.ts";

export function parseConfigCapabilitiesListResult(
  value: unknown,
): ConfigCapabilitiesListResult | null {
  if (!isRecord(value)) return null;
  const capabilities = parseUiProtocolCapabilities(value.capabilities);
  return capabilities ? { capabilities } : null;
}

export function parseUiProtocolCapabilities(value: unknown) {
  if (
    !isRecord(value) ||
    !isRecord(value.version) ||
    typeof value.version.protocol !== "string" ||
    !isNonNegativeInteger(value.version.schema_version) ||
    typeof value.version.jsonrpc !== "string" ||
    !isNonNegativeInteger(value.capabilities_schema_version) ||
    !isStringArray(value.supported_methods) ||
    !isStringArray(value.supported_notifications) ||
    (value.supported_features !== undefined &&
      !isStringArray(value.supported_features)) ||
    (value.unsupported !== undefined &&
      (!Array.isArray(value.unsupported) ||
        !value.unsupported.every(
          (entry) =>
            isRecord(entry) &&
            typeof entry.method === "string" &&
            typeof entry.reason === "string",
        )))
  ) {
    return null;
  }
  return {
    version: {
      protocol: value.version.protocol,
      schema_version: value.version.schema_version,
      jsonrpc: value.version.jsonrpc,
    },
    capabilities_schema_version: value.capabilities_schema_version,
    supported_methods: value.supported_methods,
    supported_notifications: value.supported_notifications,
    ...(value.supported_features
      ? { supported_features: value.supported_features }
      : {}),
    ...(value.unsupported ? { unsupported: value.unsupported } : {}),
  };
}

export {
  parseLaunchResolveResult,
  parseSessionListResult,
  parseSessionDeleteResult,
  parseSessionFilesListResult,
} from "./workspace-results.ts";
export { parseTokenCostUpdate } from "./workspace-events.ts";
