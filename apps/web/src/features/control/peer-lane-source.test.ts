import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import { APPUI_RESEARCH_METHODS } from "@octos-org/octoscode-client";
import type { ResearchLane } from "@octos-org/octoscode-client/research";
import {
  PEER_LANE_UNAVAILABLE_REFUSAL,
  choosePeerLane,
  peerLaneKeys,
  peerLanePickerState,
  peerLaneSourceAdmitted,
} from "./peer-lane-source.ts";

/**
 * P1 RED (grant 2810 §1): the peer dispatch LANE SOURCE. Lane keys are read
 * ONLY from the profile's real `profile/sub_providers/list` rows (via the
 * existing `researchCommands`/`parseResearchLanes` path) — never a literal.
 * An unknown lane is refused LOCALLY with the same typed kind the Core returns
 * (`driver_model_unavailable`) and emits ZERO frames; a missing capability or an
 * empty lane set leaves the picker DISABLED with no literal fallback.
 */
const caps = (
  methods: string[],
  features: string[] = [],
): UiProtocolCapabilities => ({
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: methods,
  supported_notifications: [],
  supported_features: features,
});

const lane = (key: string): ResearchLane => ({
  key,
  provider: "openai",
  model: null,
  apiKeyEnv: null,
  baseUrl: null,
  description: null,
  contextWindow: null,
  maxOutputTokens: null,
  apiType: null,
});

describe("peerLaneKeys — the ONLY sanctioned lane source", () => {
  it("maps the advertised lane keys in order", () => {
    expect(peerLaneKeys([lane("lane-primary"), lane("lane-review")])).toEqual([
      "lane-primary",
      "lane-review",
    ]);
  });

  it("skips blank keys rather than inventing one", () => {
    expect(peerLaneKeys([lane("lane-primary"), lane(""), lane("  ")])).toEqual([
      "lane-primary",
    ]);
  });

  it("returns an empty set for no lanes", () => {
    expect(peerLaneKeys([])).toEqual([]);
  });
});

describe("peerLaneSourceAdmitted — fail-closed capability gate", () => {
  it("refuses an absent capability block", () => {
    expect(peerLaneSourceAdmitted(undefined, "dev")).toBe(false);
  });

  it("refuses when the lane read is not advertised", () => {
    expect(peerLaneSourceAdmitted(caps(["peer/dispatch"]), "dev")).toBe(false);
  });

  it("refuses a blank or unknown profile", () => {
    const admitted = caps([APPUI_RESEARCH_METHODS.LIST]);
    expect(peerLaneSourceAdmitted(admitted, "")).toBe(false);
    expect(peerLaneSourceAdmitted(admitted, "   ")).toBe(false);
  });

  it("admits only when the lane read is advertised AND a profile is confirmed", () => {
    expect(
      peerLaneSourceAdmitted(caps([APPUI_RESEARCH_METHODS.LIST]), "dev"),
    ).toBe(true);
  });
});

describe("peerLanePickerState — picker disabled when the capability is absent", () => {
  it("is disabled when the read is not admitted", () => {
    expect(peerLanePickerState(false, ["lane-primary"])).toEqual({
      kind: "disabled",
    });
  });

  it("is disabled when admitted but the profile advertises no lanes", () => {
    expect(peerLanePickerState(true, [])).toEqual({ kind: "disabled" });
  });

  it("is ready with the advertised keys otherwise", () => {
    expect(peerLanePickerState(true, ["lane-primary"])).toEqual({
      kind: "ready",
      keys: ["lane-primary"],
    });
  });
});

describe("choosePeerLane — unknown lane is a TYPED refusal and sends no frame", () => {
  const keys = ["lane-primary", "lane-review"];

  it("admits an advertised lane key verbatim", () => {
    expect(choosePeerLane(keys, "lane-review")).toEqual({
      kind: "admitted",
      laneKey: "lane-review",
    });
  });

  it("refuses a lane the profile does not advertise as driver_model_unavailable", () => {
    expect(choosePeerLane(keys, "glm-5.3")).toEqual({
      kind: "refused",
      refusalKind: PEER_LANE_UNAVAILABLE_REFUSAL,
    });
  });

  it("refuses every candidate while the source is unread (null)", () => {
    expect(choosePeerLane(null, "lane-primary")).toEqual({
      kind: "refused",
      refusalKind: PEER_LANE_UNAVAILABLE_REFUSAL,
    });
  });

  it("refuses a blank or missing candidate", () => {
    expect(choosePeerLane(keys, "")).toEqual({
      kind: "refused",
      refusalKind: PEER_LANE_UNAVAILABLE_REFUSAL,
    });
  });
});

describe("peer-lane-source never hard-codes a lane", () => {
  const source = readFileSync(
    new URL("./peer-lane-source.ts", import.meta.url),
    "utf8",
  );

  it("carries no OUP boundary literal as a lane", () => {
    expect(source).not.toContain("external-master");
  });

  it("carries no fixture lane key", () => {
    expect(source).not.toContain("lane-primary");
    expect(source).not.toContain("lane-review");
  });
});
