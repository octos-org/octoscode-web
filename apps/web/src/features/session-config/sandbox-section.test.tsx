import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SandboxSection } from "./sandbox-section.tsx";

/** Interpolates {value0} like the real catalogs do. */
const t = (source: string, params?: Record<string, string | number>) =>
  params
    ? source.replace(/\{([^{}]+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : token,
      )
    : source;

describe("SandboxSection (§4.2/§7, judge #6)", () => {
  it("shows the effective fields read-only with the fixed-at-open note", () => {
    const html = renderToStaticMarkup(
      <SandboxSection
        supported
        effective={{
          enabled: true,
          networkAccess: false,
          readAllowPaths: ["/workspace", "/tmp/out"],
        }}
        t={t}
      />,
    );
    expect(html).toContain("Sandbox: on");
    expect(html).toContain("Network: blocked");
    expect(html).toContain("Read paths:");
    expect(html).toContain("/workspace");
    expect(html).toContain("/tmp/out");
    expect(html).toContain(
      "Set when the session opens — start a new session to change it",
    );
  });

  it("offers New session with… pre-filled from Defaults", () => {
    const html = renderToStaticMarkup(
      <SandboxSection
        supported
        effective={{ enabled: true, networkAccess: false, readAllowPaths: [] }}
        onNewSessionWith={() => {}}
        t={t}
      />,
    );
    expect(html).toContain("New session with…");
  });

  it("says Not supported by this server when the feature is absent", () => {
    const html = renderToStaticMarkup(
      <SandboxSection supported={false} t={t} />,
    );
    expect(html).toContain("Not supported by this server");
  });

  it("reports each field the server did not report as not reported", () => {
    const html = renderToStaticMarkup(
      <SandboxSection
        supported
        effective={{ enabled: true, networkAccess: null, readAllowPaths: null }}
        t={t}
      />,
    );
    expect(html).toContain("Network: not reported");
    expect(html).toContain("Read paths: not reported");
  });

  it("shows the sandbox off state when the session opened without one", () => {
    const html = renderToStaticMarkup(
      <SandboxSection
        supported
        effective={{
          enabled: false,
          networkAccess: null,
          readAllowPaths: null,
        }}
        t={t}
      />,
    );
    expect(html).toContain("Sandbox: off");
  });
});
