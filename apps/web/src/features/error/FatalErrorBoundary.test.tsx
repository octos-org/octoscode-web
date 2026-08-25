import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildSafeDiagnostic,
  FatalCrashScreen,
} from "./FatalErrorBoundary.tsx";

describe("fatal render recovery", () => {
  it("redacts query and bearer credentials from diagnostics", () => {
    const report = buildSafeDiagnostic(
      new Error(
        "failed at ws://host/ws?token=secret-value&ui_feature=x Bearer second-secret",
      ),
    );
    expect(report).toContain("token=[redacted]&ui_feature=x");
    expect(report).toContain("Bearer [redacted]");
    expect(report).not.toContain("secret-value");
    expect(report).not.toContain("second-secret");
  });

  it("explains durable-state safety and renders recovery actions", () => {
    const html = renderToStaticMarkup(
      <FatalCrashScreen report="Error: render failed" />,
    );
    expect(html).toContain("durable session state remain");
    expect(html).toContain("Reload app");
    expect(html).toContain("Copy diagnostics");
  });
});
