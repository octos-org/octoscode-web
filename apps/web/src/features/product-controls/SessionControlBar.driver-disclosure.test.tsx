import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SessionControlBar,
  type RuntimeModelControlProps,
  type SessionControlBarProps,
} from "./SessionControlBar.tsx";
import type {
  DriverInventoryDisclosure,
  DriverInventoryState,
} from "../session/driver-discovery.ts";

/** Read-only controller-seat regression (1827, corrected 1831). The mounted
 * SessionControlBar is expected to accept an OPTIONAL driverInventory state
 * from the selected record; the current component does NOT yet. We cast
 * through a narrow intersection so this file typechecks and RUNS against the
 * existing component (no missing new component import). The absent
 * "Session controller" seat is the intended RED; synthetic data only. */
type ProbeProps = SessionControlBarProps & {
  driverInventory?: DriverInventoryState | undefined;
};
const Bar = SessionControlBar as unknown as (
  props: ProbeProps,
) => ReactElement | null;

const runtime = (
  onOpenSettings: () => void = vi.fn(),
): RuntimeModelControlProps => ({ label: "Fixture runtime", onOpenSettings });

const binding = (
  over: Partial<{
    driverId: string;
    epoch: number;
    revision: number;
    leaseExpiresAtMs: number;
  }> = {},
) => ({ driverId: "d1", epoch: 1, revision: 2, leaseExpiresAtMs: 0, ...over });

const complete = (
  disclosure: DriverInventoryDisclosure,
): DriverInventoryState => ({
  kind: "complete",
  snapshot: "snap-1",
  observedRevision: "7",
  rows: [],
  completedAtMs: 1,
  disclosure,
});

const render = (
  driverInventory: DriverInventoryState | undefined,
  runtimeModel: RuntimeModelControlProps | null = runtime(),
): string =>
  renderToStaticMarkup(
    <Bar
      ariaLabel="Session controls"
      permission={null}
      model={null}
      runtimeModel={runtimeModel}
      driverInventory={driverInventory}
    />,
  );

describe("SessionControlBar controller disclosure", () => {
  it("renders a keyboard-native details/summary seat for external recovery_required", () => {
    const html = render(
      complete({
        mode: "external",
        recovery: "recovery_required",
        binding: binding(),
      }),
    );
    // Baseline FIRST: the existing render already succeeded.
    expect(html).toContain("Fixture runtime");
    // Native, keyboard-focusable disclosure structure — not just a generic
    // aria label or text node.
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).toContain('aria-label="Session controller"');
    expect(html).toContain("External controller");
    expect(html).toContain("Recovery required");
    // Public binding labels + the actual public value.
    expect(html).toContain("Driver");
    expect(html).toContain("Epoch");
    expect(html).toContain("Revision");
    expect(html).toContain("d1");
    // No control inputs/buttons are added inside the disclosure.
    expect(html.match(/<button/g) ?? []).toHaveLength(1);
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<textarea");
  });

  it("keeps an internal controller internal with a null binding", () => {
    const html = render(
      complete({ mode: "internal", recovery: "none", binding: null }),
    );
    expect(html).toContain("Fixture runtime");
    expect(html).toContain("Internal controller");
    expect(html).toContain("No recovery pending");
    expect(html).not.toContain("External controller");
  });

  it("keeps a zero-lease external controller external, never internal", () => {
    const html = render(
      complete({
        mode: "external",
        recovery: "none",
        binding: binding({ leaseExpiresAtMs: 0 }),
      }),
    );
    expect(html).toContain("Fixture runtime");
    expect(html).toContain("External controller");
    expect(html).toContain("No active lease");
    expect(html).not.toContain("Internal controller");
  });

  it("surfaces an interrupted recovery as Interrupted", () => {
    const html = render(
      complete({
        mode: "external",
        recovery: "interrupted",
        binding: binding(),
      }),
    );
    expect(html).toContain("Fixture runtime");
    expect(html).toContain("Interrupted");
    expect(html).toContain("External controller");
  });

  it("describes a nonzero lease neutrally, never as live", () => {
    const html = render(
      complete({
        mode: "external",
        recovery: "none",
        binding: binding({ leaseExpiresAtMs: 1_700_000_000_000 }),
      }),
    );
    expect(html).toContain("Fixture runtime");
    expect(html).toContain("Lease expires");
    expect(html).not.toContain("No active lease");
    expect(html).not.toContain("Live controller");
  });

  it("shows no stale owner for non-complete states and runs no callback", () => {
    const onOpenSettings = vi.fn();
    const states: readonly DriverInventoryState[] = [
      { kind: "unavailable" },
      { kind: "loading" },
      { kind: "error", reason: "stale" },
    ];
    for (const state of states) {
      const html = render(state, runtime(onOpenSettings));
      expect(html).toContain("Fixture runtime");
      expect(html).not.toContain("Session controller");
      expect(html).not.toContain("External controller");
      expect(html).not.toContain("d1");
    }
    // No fake client: the seat is pure read-only state, so rendering a
    // non-complete inventory must not fire any control callback.
    expect(onOpenSettings).not.toHaveBeenCalled();
  });

  it("still renders the read-only seat when every other control is null", () => {
    const html = render(
      complete({ mode: "external", recovery: "none", binding: binding() }),
      null,
    );
    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain("Session controller");
  });

  it("preserves the legacy runtime seat when the prop is omitted", () => {
    const html = renderToStaticMarkup(
      <Bar
        ariaLabel="Session controls"
        permission={null}
        model={null}
        runtimeModel={runtime()}
      />,
    );
    expect(html).toContain("Fixture runtime");
    expect(html).not.toContain("Session controller");
  });

  it("escapes a hostile driver id and excludes synthetic extras", () => {
    const disclosure = {
      mode: "external",
      recovery: "none",
      binding: binding({ driverId: '<img src=x onerror="alert(1)">' }),
      controlToken: "SECRET-TOKEN",
      workspaceRoot: "/private/SECRET",
    } as DriverInventoryDisclosure;
    const html = render(complete(disclosure));
    expect(html).toContain("Fixture runtime");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("SECRET");
    expect(html).not.toContain("workspaceRoot");
    expect(html).not.toContain("acceptedWork");
  });
});