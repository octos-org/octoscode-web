import { CORE_UI_FEATURES } from "./generated/core-contract.ts";
import { supportsFeature, supportsMethod } from "./interaction.ts";
import { isRecord } from "./rpc.ts";
import { isProtocolUuid } from "./supervision.ts";
import type { UiProtocolCapabilities } from "./types.ts";

/** Handwritten AppUI extension, pinned rc11 ui_protocol_transport.rs:319. */
export const TURN_STEER_METHOD = "turn/steer";
export interface TurnSteerResult {
  turn_id: string;
  steered: boolean;
}
export interface SteerCommands {
  steer(expectedTurnId: string, text: string): Promise<TurnSteerResult>;
}
export function supportsSteering(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return (
    supportsMethod(capabilities, TURN_STEER_METHOD) &&
    supportsFeature(capabilities, CORE_UI_FEATURES.TURN_STEER_DROPPED_V1)
  );
}
export function createSteerCommands(
  rpc: { request(method: string, params: unknown): Promise<unknown> },
  sessionId: string,
  capabilities: UiProtocolCapabilities | undefined,
): SteerCommands {
  // Validate before the host's markSent boundary. Losing a capability on
  // reconnect must queue input, not invent an ambiguous allegedly-sent request.
  if (
    !sessionId.trim() ||
    sessionId !== sessionId.trim() ||
    !supportsSteering(capabilities)
  )
    throw new Error("Safe native steering is unavailable for this Session");
  return {
    async steer(expectedTurnId, text) {
      if (!isProtocolUuid(expectedTurnId) || !text.trim())
        throw new Error("Steering requires a confirmed turn and nonempty text");
      const value = await rpc.request(TURN_STEER_METHOD, {
        session_id: sessionId,
        expected_turn_id: expectedTurnId,
        input: [{ kind: "text", text: text.trim() }],
      });
      if (
        !isRecord(value) ||
        !isProtocolUuid(value.turn_id) ||
        typeof value.steered !== "boolean" ||
        (value.steered
          ? value.turn_id !== expectedTurnId
          : value.turn_id === expectedTurnId)
      )
        throw new Error(
          "Native steering returned an invalid receipt; its outcome is unknown",
        );
      return { turn_id: value.turn_id, steered: value.steered };
    },
  };
}
