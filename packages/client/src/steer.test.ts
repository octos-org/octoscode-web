import { describe, expect, it, vi } from "vitest";
import { createSteerCommands, supportsSteering } from "./steer.ts";
import type { UiProtocolCapabilities } from "./types.ts";
const active = "11111111-1111-4111-8111-111111111111";
const next = "22222222-2222-4222-8222-222222222222";
const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: ["turn/steer"],
  supported_notifications: ["turn/steer_dropped"],
  supported_features: ["event.turn_steer_dropped.v1"],
};
describe("native steering contract", () => {
  it("requires both native method and lossless return feature", () => {
    expect(supportsSteering(caps)).toBe(true);
    expect(supportsSteering({ ...caps, supported_features: [] })).toBe(false);
    expect(supportsSteering({ ...caps, supported_methods: [] })).toBe(false);
  });
  it("sends the exact native kind-tagged input with a captured full Session", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ turn_id: active, steered: true });
    const result = await createSteerCommands(
      { request },
      "master#peer",
      caps,
    ).steer(active, " correction ");
    expect(request).toHaveBeenCalledWith("turn/steer", {
      session_id: "master#peer",
      expected_turn_id: active,
      input: [{ kind: "text", text: "correction" }],
    });
    expect(result).toEqual({ turn_id: active, steered: true });
  });
  it("accepts the server-minted fallback UUID without inventing another start", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ turn_id: next, steered: false });
    expect(
      await createSteerCommands({ request }, "master", caps).steer(
        active,
        "correction",
      ),
    ).toEqual({ turn_id: next, steered: false });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
