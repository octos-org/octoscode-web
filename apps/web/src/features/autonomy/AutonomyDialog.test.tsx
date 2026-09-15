import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AutonomyDialog } from "./AutonomyDialog.tsx";

describe("autonomy dialog loading boundary", () => {
  it("provides a closable labelled modal without starting work or rendering its authority key", () => {
    const factory = vi.fn();
    const html = renderToStaticMarkup(
      createElement(AutonomyDialog, {
        client: { autonomyCommands: factory, subscribeNotifications: vi.fn() },
        sessionId: "s1",
        authorityKey: "private-runtime-identity",
        capabilities: {
          version: {
            protocol: "octos-ui/v1alpha1",
            schema_version: 1,
            jsonrpc: "2.0",
          },
          capabilities_schema_version: 2,
          supported_methods: [],
          supported_features: [],
          supported_notifications: [],
        },
        onClose: vi.fn(),
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="autonomy-dialog-title"');
    expect(html).toContain("Close autonomy");
    expect(html).toContain("Loading autonomy controls");
    expect(html).not.toContain("private-runtime-identity");
    expect(factory).not.toHaveBeenCalled();
  });
});
