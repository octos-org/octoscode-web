import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  shouldRouteNoModelSetup,
  type NoModelSetupInput,
} from "../features/connection/no-model-setup.ts";

/**
 * Live hotfix (walkthrough 4200b, PNG 02): the §5.1 routing fired pre-session
 * on the LIVE Core. The LIVE profile/llm/list (walkthrough log s3 pane dump)
 * carries a healthy primary (zai-coding / glm-5.3) — routing must never fire
 * there; and pre-session (no session/open, only config/capabilities/list on
 * the wire) it must not fire AT ALL.
 */
const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

const LIVE_LISTED: NoModelSetupInput = {
  available: true,
  loading: false,
  models: [
    {
      model: "glm-5.3",
      provider: "zai-coding",
      title: "GLM 5.3",
      family: "zai-coding",
      route: "official",
      selected: true,
      available: true,
    },
  ],
};

describe("(1) no-model gate requires an OPEN session + completed fetch", () => {
  it("never routes on the LIVE healthy list (primary present)", () => {
    expect(shouldRouteNoModelSetup(LIVE_LISTED)).toBe(false);
  });

  it("never routes without an open session — even fetched-looking state", () => {
    const gated = shouldRouteNoModelSetup({ ...LIVE_LISTED, models: [] });
    expect(gated).toBe(false);
  });

  it("routes only with an open session AND a settled empty/unusable list", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: false,
        models: [],
        fetched: true,
      }),
    ).toBe(true);
  });

  it("never routes while loading or before a fetch completed", () => {
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: true,
        models: [],
        fetched: true,
      }),
    ).toBe(false);
    expect(
      shouldRouteNoModelSetup({
        available: true,
        loading: false,
        models: [],
        fetched: false,
      }),
    ).toBe(false);
  });

  it("App's effect gates on session.opened and the pure gate", () => {
    // session.opened must guard FIRST, then the pure gate decides.
    expect(app).toMatch(
      /if \(!session\.opened\) return;\s*if \(!session\.authenticated\) return;\s*if \(\s*shouldRouteNoModelSetup/,
    );
    // The workspace chooser must stay the default post-connect surface: no
    // authenticated-only early-return that opens Settings remains.
    expect(app).not.toMatch(
      /if \(!session\.authenticated\) return; if \(!models\.state\.available\) return;/,
    );
  });
});

describe("(2) Fleet pane hidden pre-session; empty state without Start", () => {
  it("renders the Fleet pane only when routed AND a session is open", () => {
    expect(app).toMatch(/hidden=\{!\(fleetRouteActive && session\.opened\)\}/);
  });

  it("offers the pre-session Fleet destination with an open-a-project empty state", () => {
    // The nav entry stays reachable; the pane shows the empty state and NO
    // Start form until a session exists.
    expect(app).toContain("Open a project first");
    const fleetPaneStart = app.indexOf(
      "hidden={!(fleetRouteActive && session.opened)}",
    );
    const emptyStateRegion = app.slice(fleetPaneStart, fleetPaneStart + 2200);
    expect(emptyStateRegion).toMatch(/session\.opened \?/);
    expect(emptyStateRegion).toMatch(/<FleetPane/);
  });
});
