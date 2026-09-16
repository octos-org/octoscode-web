import { describe, expect, it } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  buildPeerDispatchParams,
  peerDispatchAdmitted,
  peerDispatchRefusalLabel,
} from "./peer-dispatch-commands.ts";

const caps = (
  methods: string[],
  features: string[],
): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: features,
});

const seed = { brief: "Review this", slug: "review", prompt: "kickoff text" };

describe("peerDispatchAdmitted — fail-closed capability gate", () => {
  it("refuses an absent capability block", () => {
    expect(peerDispatchAdmitted(undefined)).toBe(false);
  });
  it("refuses when peer/dispatch is not advertised", () => {
    expect(
      peerDispatchAdmitted(caps(["peer/control"], ["external_driver_v1"])),
    ).toBe(false);
  });
  it("refuses when external_driver_v1 is not advertised", () => {
    expect(peerDispatchAdmitted(caps(["peer/dispatch"], []))).toBe(false);
  });
  it("admits only when BOTH peer/dispatch and external_driver_v1 are present", () => {
    expect(
      peerDispatchAdmitted(caps(["peer/dispatch"], ["external_driver_v1"])),
    ).toBe(true);
  });
});

describe("buildPeerDispatchParams — pure one-frame argument build", () => {
  const fence = { driverId: "drv-1", epoch: 7, controlToken: "tok-1" };

  it("carries the caller-held fence verbatim and the stable operationId", () => {
    const params = buildPeerDispatchParams(fence, "op-1", seed, "glm-5.3");
    expect(params.driverId).toBe("drv-1");
    expect(params.epoch).toBe(7);
    expect(params.controlToken).toBe("tok-1");
    expect(params.operationId).toBe("op-1");
  });
  it("sends the REQUESTED model lane, not a resolved model", () => {
    expect(buildPeerDispatchParams(fence, "op-1", seed, "glm-5.3").model).toBe(
      "glm-5.3",
    );
  });
  it("builds a new_brief target from the brief, titling it with the slug", () => {
    const params = buildPeerDispatchParams(fence, "op-1", seed, "glm-5.3");
    expect(params.dispatch).toEqual({
      kind: "new_brief",
      brief: "Review this",
      title: "review",
    });
  });
  it("forwards the kickoff prompt as the ordered text input", () => {
    const params = buildPeerDispatchParams(fence, "op-1", seed, "glm-5.3");
    expect(params.kickoffInput).toEqual([
      { kind: "text", text: "kickoff text" },
    ]);
  });
  it("omits a kickoff input when the seed carries no prompt", () => {
    const params = buildPeerDispatchParams(
      fence,
      "op-1",
      { ...seed, prompt: "" },
      "glm-5.3",
    );
    expect(params.kickoffInput).toBeUndefined();
  });
});

describe("peerDispatchRefusalLabel — stable copy, never raw server text", () => {
  it("labels a known refusal kind", () => {
    // §6 (design 4000): task words, never protocol vocabulary.
    expect(peerDispatchRefusalLabel("driver_fence_stale")).toBe(
      "Your control of this session expired",
    );
  });
  it("degrades an unknown kind to a generic label", () => {
    expect(peerDispatchRefusalLabel("something_new")).toBe(
      "Couldn't start that peer.",
    );
  });
});
