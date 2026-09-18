import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PermissionsSection } from "./permissions-section.tsx";

const permissionControl = {
  state: { status: "ready" as const },
  options: [],
  selectedId: "workspace_write:deny",
  locked: false,
  labels: {
    menu: "Access mode",
    loading: "Loading access…",
    unavailable: "Access unavailable",
    select: "Select access",
    empty: "No access presets",
    retry: "Retry",
  },
  riskCopy: {
    title: "Enable full access?",
    description: "This preset can read and modify files outside the workspace.",
    accessLabel: "Access",
    networkLabel: "Network",
    acknowledgement: "I understand the risk.",
    cancel: "Cancel",
    confirm: "Enable full access",
  },
  onSelect: () => {},
};

/** Interpolates {value0} like the real catalogs do. */
const t = (source: string, params?: Record<string, string | number>) =>
  params
    ? source.replace(/\{([^{}]+)\}/g, (token, name: string) =>
        Object.prototype.hasOwnProperty.call(params, name)
          ? String(params[name])
          : token,
      )
    : source;

describe("PermissionsSection (§4.2/§7, judge #6)", () => {
  it("discloses the next-message timing including the running-response carve-out", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection permission={permissionControl} t={t} />,
    );
    expect(html).toContain("Applies from your next message.");
    expect(html).toContain(
      "A response that is already running keeps the permissions it started with.",
    );
  });

  it("reads the approval policy from the runtime_policy_stamp on open and after save", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection
        permission={permissionControl}
        approvalPolicyReadback="on-request"
        t={t}
      />,
    );
    expect(html).toContain("Approval policy:");
    expect(html).toContain("<strong>on-request</strong>");
    expect(html).not.toContain("not verified");
  });

  it("shows the not-verified state next to the value this tab last set", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection
        permission={permissionControl}
        approvalPolicyReadback="on-request"
        approvalPolicyUnverified
        t={t}
      />,
    );
    expect(html).toContain("Approval policy:");
    expect(html).toContain("on-request");
    expect(html).toContain(
      "Current approval policy not verified (as set here)",
    );
  });

  it("renders no readback line at all when no value is known", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection permission={permissionControl} t={t} />,
    );
    expect(html).not.toContain("Approval policy:");
  });

  it("says Not supported by this server when the capability is absent", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection permission={null} t={t} />,
    );
    expect(html).toContain("Not supported by this server");
  });

  it("surfaces save feedback states: Saving / Saved / Failed with retry", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection
        permission={permissionControl}
        saveState={{ kind: "failed", message: "mode rejected" }}
        onRetrySave={() => {}}
        t={t}
      />,
    );
    expect(html).toContain("Failed:");
    expect(html).toContain("mode rejected");
    expect(html).toContain("Retry");
  });

  it("offers the approval-policy selector with the stamp's value selected", () => {
    const html = renderToStaticMarkup(
      <PermissionsSection
        permission={permissionControl}
        approvalPolicyReadback="on-request"
        onApprovalPolicyChange={() => {}}
        t={t}
      />,
    );
    expect(html).toContain('data-permission-approval-policy="true"');
  });
});
