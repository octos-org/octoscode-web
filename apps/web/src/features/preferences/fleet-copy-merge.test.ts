import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import zh from "./zh.ts";
import { FLEET_ZH_COPY } from "../fleet/fleet-copy.ts";

/**
 * Judge r1 #8 (round 2, WEB-UX-ROUND2-4400): "Fleet's separate catalog is
 * never imported into the loaded Chinese catalog" — `loadChineseCatalog`
 * (ui-text.tsx:42) imports ONLY ./zh.ts, so every FLEET_ZH_COPY string was
 * untranslated in zh. The merge lives in zh.ts (copy-03b owns that file and
 * the import line; fleet-02 owns the catalog contents).
 *
 * RED-first: before the import line this suite fails on the first expectation.
 */

describe("zh catalog loads the Fleet translations", () => {
  it("carries every fleet-copy key", () => {
    for (const [source, translated] of Object.entries(FLEET_ZH_COPY)) {
      expect(zh[source], source).toBe(translated);
    }
  });

  it("keeps fleet values on collision (fleet-02 authored them for the surface)", () => {
    // The known collision: zh.ts historically carried "Session peers" for the
    // dock; the Fleet rows list uses the same key and fleet-02's value is the
    // round-2 vocabulary.
    expect(zh["Session peers"]).toBe(FLEET_ZH_COPY["Session peers"]);
    expect(zh["No peers yet"]).toBe("还没有同侪");
    expect(zh["Peer {value0}"]).toBe("同侪 {value0}");
  });

  it("preserves placeholder parity across the merged catalog", () => {
    for (const [source, translated] of Object.entries(zh)) {
      expect(translated.match(/\{\w+\}/g)?.sort() ?? [], source).toEqual(
        source.match(/\{\w+\}/g)?.sort() ?? [],
      );
    }
  });

  it("the import line exists in source (wiring pin)", () => {
    const source = readFileSync(new URL("./zh.ts", import.meta.url), "utf8");
    expect(source).toContain("fleet/fleet-copy.ts");
  });
});
