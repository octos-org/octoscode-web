import { describe, expect, it } from "vitest";
import {
  APPUI_ONBOARDING_FEATURES,
  APPUI_WORKSPACE_BROWSE_METHODS,
  parseWorkspaceListResult,
  supportsWorkspaceBrowse,
  workspaceBrowseRefusal,
  WORKSPACE_BROWSE_MAX_ENTRIES,
  WORKSPACE_CREATE_REFUSAL_KINDS,
  WORKSPACE_LIST_REFUSAL_KINDS,
} from "../src/index.ts";
import { OctosUiProtocolError } from "../src/client.ts";
import type { UiProtocolCapabilities } from "../src/types.ts";

/** WEB-WORKSPACE-BROWSER-CONTRACT-5000 — the client half of the contract. */

const LISTING = {
  canonical_path: "/Users/me/projects",
  parent_path: "/Users/me",
  writable: true,
  entries: [
    {
      name: "octoscode-web",
      path: "/Users/me/projects/octoscode-web",
      writable: true,
    },
    { name: "notes", path: "/Users/me/projects/notes", writable: false },
  ],
  truncated: false,
  hidden_skipped: 3,
};

const CAPABILITIES: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [
    APPUI_WORKSPACE_BROWSE_METHODS.WORKSPACE_LIST,
    APPUI_WORKSPACE_BROWSE_METHODS.WORKSPACE_CREATE,
  ],
  supported_notifications: [],
  supported_features: [APPUI_ONBOARDING_FEATURES.WORKSPACE_BROWSE_V1],
};

describe("workspace_list result contract", () => {
  it("decodes the contract's example listing verbatim", () => {
    expect(parseWorkspaceListResult(LISTING)).toEqual(LISTING);
  });

  it("accepts a full, truncated page of 500 entries", () => {
    const entries = Array.from(
      { length: WORKSPACE_BROWSE_MAX_ENTRIES },
      (_value, index) => ({
        name: `folder-${index}`,
        path: `/Users/me/projects/folder-${index}`,
        writable: true,
      }),
    );
    const page = { ...LISTING, entries, truncated: true };
    expect(parseWorkspaceListResult(page)?.entries).toHaveLength(
      WORKSPACE_BROWSE_MAX_ENTRIES,
    );
    expect(
      parseWorkspaceListResult({
        ...page,
        entries: [...entries, { name: "over", path: "/over", writable: true }],
      }),
    ).toBeNull();
  });
});

describe("typed refusals", () => {
  it("whitelists every kind the contract defines, both families", () => {
    for (const kind of [
      ...WORKSPACE_LIST_REFUSAL_KINDS,
      ...WORKSPACE_CREATE_REFUSAL_KINDS,
    ]) {
      expect(
        workspaceBrowseRefusal(
          new OctosUiProtocolError(-32_010, "server prose", { kind }),
        ),
      ).toEqual({ kind });
    }
  });
});

describe("feature gate", () => {
  it("opens only on the advertised feature and fails closed otherwise", () => {
    expect(supportsWorkspaceBrowse(CAPABILITIES)).toBe(true);
    expect(supportsWorkspaceBrowse(undefined)).toBe(false);
    expect(
      supportsWorkspaceBrowse({ ...CAPABILITIES, supported_features: [] }),
    ).toBe(false);
    const { supported_features: _absent, ...withoutFeatures } = CAPABILITIES;
    expect(supportsWorkspaceBrowse(withoutFeatures)).toBe(false);
    // An advertised method is never the gate.
    expect(
      supportsWorkspaceBrowse({
        ...CAPABILITIES,
        supported_features: ["onboarding.workspace_probe.v1"],
      }),
    ).toBe(false);
  });
});
