import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ContextPanel, type ContextPanelProps } from "./ContextPanel.tsx";

const base: ContextPanelProps = {
  sessionId: "s1",
  capabilities: {
    version: {
      protocol: "octos-ui/v1alpha1",
      schema_version: 1,
      jsonrpc: "2.0",
    },
    capabilities_schema_version: 2,
    supported_methods: [],
    supported_notifications: [],
  },
  snapshot: null,
  usage: null,
  onCompact: vi.fn(),
  onModeChange: vi.fn(),
};
describe("context product surface", () => {
  it("does not invent usage or expose unadvertised controls", () => {
    const html = renderToStaticMarkup(<ContextPanel {...base} />);
    expect(html).toContain("Not reported");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<progress");
  });
  it("shows authoritative occupancy and zero cache usage", () => {
    const html = renderToStaticMarkup(
      <ContextPanel
        {...base}
        snapshot={{
          state: {
            session_id: "s1",
            generation: 3,
            token_estimate: 100,
            item_count: 4,
            recovery_state: "exact",
            cache_epoch_id: "epoch-a",
          },
        }}
        usage={{
          sessionId: "s1",
          contextWindow: 1000,
          inputTokens: 9000,
          cacheReadTokens: 0,
        }}
      />,
    );
    expect(html).toContain("10% of 1,000");
    expect(html).toContain("0 tokens");
    expect(html).toContain("epoch-a");
  });
  it("cannot render another session snapshot or cache usage", () => {
    const html = renderToStaticMarkup(
      <ContextPanel
        {...base}
        snapshot={{
          state: {
            session_id: "s2",
            generation: 3,
            token_estimate: 100,
            item_count: 4,
            recovery_state: "exact",
            cache_epoch_id: "private-epoch",
          },
        }}
        usage={{ sessionId: "s2", cacheReadTokens: 12345 }}
      />,
    );
    expect(html).not.toContain("private-epoch");
    expect(html).not.toContain("12,345");
  });
});
