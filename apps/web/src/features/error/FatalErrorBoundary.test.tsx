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

  it("redacts auth_token and api_key query credentials", () => {
    const report = buildSafeDiagnostic(
      new Error(
        "connect to ws://host?auth_token=auth-secret&api_key=key-secret",
      ),
    );
    expect(report).toContain("auth_token=[redacted]");
    expect(report).toContain("api_key=[redacted]");
    expect(report).not.toContain("auth-secret");
    expect(report).not.toContain("key-secret");
  });
});
