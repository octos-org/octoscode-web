/**
 * Fleet zh catalog — GLM-WEB-UX2-FLEET-VIEW-4010 RED (design §8: "both
 * language catalogs carry every string"; brief: zh keys live in a NEW
 * features/fleet/fleet-copy.ts, NOT zh.ts which another owner edits).
 *
 * RED: fleet-copy.ts does not exist yet.
 */
import { describe, expect, it } from "vitest";
import { FLEET_ZH_COPY, fleetCopyKeys } from "./fleet-copy.ts";

describe("fleet zh copy catalog", () => {
  it("covers every fleet copy key with non-empty zh text", () => {
    const keys = fleetCopyKeys();
    expect(keys.length).toBeGreaterThan(20);
    for (const key of keys)
      expect(
        typeof FLEET_ZH_COPY[key] === "string" && FLEET_ZH_COPY[key]!.length > 0,
        key,
      ).toBe(true);
  });

  it("preserves every interpolation placeholder", () => {
    for (const key of fleetCopyKeys()) {
      const source = key;
      const translated = FLEET_ZH_COPY[key]!;
      expect(
        translated.match(/\{\w+\}/g)?.sort() ?? [],
        source,
      ).toEqual(source.match(/\{\w+\}/g)?.sort() ?? []);
    }
  });

  it("carries the status words with no protocol vocabulary", () => {
    for (const source of [
      "Requested",
      "Starting",
      "Still starting…",
      "Working",
      "Waiting for your approval",
      "Waiting for your answer",
      "Finished",
      "Stopped",
      "Failed",
      "Outcome unknown",
      "No peers yet",
      "Start a peer",
      "Model",
      "Brief",
      "Session",
      "Start",
      "Approve",
      "Deny",
      "Steer",
      "Stop",
      "Sent",
      "Stop requested",
      "Stopped",
      "Already handled",
      "Finished ({value0})",
      "Peers",
      "This server does not support remote control of peers",
      "No peer models are configured — add one under Settings › Providers",
      "Open a project first",
      "Loading models…",
      "Take control of {value0} to do this",
      "Peer started a new turn",
      "Couldn't restore this peer",
      "Restoring…",
      "Peer started {value0}",
      "Back to Fleet",
      "Fleet",
      "Only while waiting for approval",
      "Only while waiting for your answer",
    ] as const)
      expect(FLEET_ZH_COPY, source).toHaveProperty(source);
    for (const translated of Object.values(FLEET_ZH_COPY)) {
      expect(translated).not.toMatch(
        /seat|epoch|lane|slug|fence|operation id|binding/i,
      );
    }
  });
});