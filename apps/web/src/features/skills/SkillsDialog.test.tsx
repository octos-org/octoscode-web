import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { SkillsDialog } from "./SkillsDialog.tsx";

const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["profile/skills/list"],
  supported_notifications: [],
};
const client = new OctosUiClient({ endpoint: "ws://example.invalid" });
describe("profile skills surface", () => {
  it("hides unadvertised mutation/search controls and does not fabricate inventory", () => {
    const html = renderToStaticMarkup(
      <SkillsDialog
        client={client}
        profileId="p1"
        capabilities={capabilities}
        profileBusy={false}
        onMutationStart={() => () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("Server Profile: ");
    expect(html).not.toContain("No skills installed");
    expect(html).not.toContain("Review source");
    expect(html).not.toContain("Search registry");
  });
  it("reviews sources read-only and warns about executable dependencies", () => {
    const html = renderToStaticMarkup(
      <SkillsDialog
        client={client}
        profileId="p1"
        capabilities={{
          ...capabilities,
          supported_methods: [
            ...capabilities.supported_methods,
            "profile/skills/install",
          ],
        }}
        profileBusy={true}
        onMutationStart={() => () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain("download executable tools and dependencies");
    // Disabled only until a source is typed: reviewing writes nothing.
    expect(html).toContain('disabled="">Review source</button>');
    expect(html).not.toMatch(/Confirm install|Install from source/);
  });
});
