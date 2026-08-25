import {
  CORE_UI_CONTRACT_SOURCE,
  CORE_UI_PROTOCOL,
} from "./generated/core-contract.ts";
import type { UiProtocolCapabilities } from "./types.ts";

export const SUPPORTED_OCTOS_CONTRACT = {
  ...CORE_UI_CONTRACT_SOURCE,
  protocol: CORE_UI_PROTOCOL.protocol,
} as const;

/** Returns a user-safe reason when a server capability envelope is incompatible. */
export function coreProtocolCompatibilityError(
  capabilities: UiProtocolCapabilities | undefined,
): string | null {
  if (!capabilities) return "session/open did not include capabilities";
  const { version, capabilities_schema_version: capabilitiesSchemaVersion } =
    capabilities;
  if (version.protocol !== CORE_UI_PROTOCOL.protocol) {
    return `protocol ${version.protocol} is not ${CORE_UI_PROTOCOL.protocol}`;
  }
  if (version.jsonrpc !== CORE_UI_PROTOCOL.jsonrpc) {
    return `JSON-RPC ${version.jsonrpc} is not ${CORE_UI_PROTOCOL.jsonrpc}`;
  }
  if (
    version.schema_version < 1 ||
    version.schema_version > CORE_UI_PROTOCOL.schema_version
  ) {
    return `protocol schema ${version.schema_version} is outside 1..${CORE_UI_PROTOCOL.schema_version}`;
  }
  if (
    capabilitiesSchemaVersion < 1 ||
    capabilitiesSchemaVersion > CORE_UI_PROTOCOL.capabilities_schema_version
  ) {
    return `capabilities schema ${capabilitiesSchemaVersion} is outside 1..${CORE_UI_PROTOCOL.capabilities_schema_version}`;
  }
  return null;
}
