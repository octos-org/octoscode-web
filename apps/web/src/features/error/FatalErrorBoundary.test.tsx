import { describe, expect, it } from "vitest";
import { buildSafeDiagnostic } from "./FatalErrorBoundary.tsx";

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
});
