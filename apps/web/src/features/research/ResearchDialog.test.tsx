import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OctosUiClient,
  type UiProtocolCapabilities,
} from "@octos-org/octoscode-client";
import { ResearchDialog } from "./ResearchDialog.tsx";
const capabilities: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: ["profile/sub_providers/list"],
  supported_notifications: [],
};
const client = new OctosUiClient({ endpoint: "ws://example.invalid" });
describe("research settings surface", () => {
  it("distinguishes provider identity from API style and hides unavailable mutations", () => {
    const html = renderToStaticMarkup(
      <ResearchDialog
        client={client}
        profileId="p1"
        capabilities={capabilities}
        profileBusy={false}
        onMutationStart={() => () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain(
      "Provider identity and API style are separate fields",
    );
    expect(html).not.toContain("No research lanes configured");
    expect(html).not.toContain("Review lane save");
    expect(html).not.toContain('type="password"');
  });
  it("locks writes during profile work and never prefills a credential", () => {
    const html = renderToStaticMarkup(
      <ResearchDialog
        client={client}
        profileId="p1"
        capabilities={{
          ...capabilities,
          supported_methods: [
            ...capabilities.supported_methods,
            "profile/sub_providers/upsert",
          ],
        }}
        profileBusy={true}
        onMutationStart={() => () => {}}
        onClose={() => {}}
      />,
    );
    expect(html).toContain('type="password" autoComplete="off"');
    expect(html).toContain('disabled="">Review lane save');
    expect(html).not.toContain('type="password" value=');
    expect(html).not.toContain("Confirm save");
  });
});
