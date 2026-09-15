/**
 * PeerControllerPanel controlled-state harness — P2b RED (grant 2855).
 *
 * apps/web has NO jsdom, so a real click cannot be simulated. This file uses
 * the repo's SECOND convention (`ComposerInput.test.tsx:1-40`): `react` is
 * mocked so `useState` is a controllable store, the component is invoked as a
 * plain function, and the returned element tree is walked by data-attribute.
 *
 * The contract asserted here is the ROOT addition to P2b: an operator can TYPE
 * a brief and CHOOSE a lane in the product, Dispatch enables only then, and the
 * ONE submit carries exactly the typed/chosen values into a single
 * `peer/dispatch` frame (`planPeerDispatch`).
 */
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DriverAcquireView } from "@octos-org/octoscode-client/external-driver";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import type { PeerControllerStagingSubmit } from "./peer-controller-staging.ts";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[],
  cursor: 0,
}));

vi.mock("react", async (original) => {
  const actual = await original<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = initial;
      const set = (next: unknown) => {
        hooks.states[index] =
          typeof next === "function"
            ? (next as (previous: unknown) => unknown)(hooks.states[index])
            : next;
      };
      return [hooks.states[index], set];
    },
  };
});

vi.mock("../preferences/ui-text.tsx", () => ({
  useUiText: () => (text: string, params?: Record<string, string | number>) =>
    params
      ? text.replace(/\{([^{}]+)\}/g, (token: string, name: string) =>
          Object.prototype.hasOwnProperty.call(params, name)
            ? String(params[name])
            : token,
        )
      : text,
}));

const { PeerControllerPanel } = await import("./PeerControllerPanel.tsx");
const { planPeerDispatch } = await import("../session/use-octos-session.ts");

const CAPABILITIES: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 1,
  supported_methods: [
    EXTERNAL_DRIVER_METHODS.PEER_CONTROL,
    EXTERNAL_DRIVER_METHODS.PEER_DISPATCH,
  ],
  supported_notifications: [],
  supported_features: [EXTERNAL_DRIVER_V1_FEATURE],
};

const LANES = ["lane-primary", "lane-review"] as const;

const ACQUIRE: DriverAcquireView = {
  capability: { driverId: "drv-1", epoch: 7, reveal: () => "tok-secret" },
  binding: {
    driverId: "drv-1",
    epoch: 7,
    revision: 12,
    leaseExpiresAtMs: 1_700_000_000_000,
    acceptedWork: [],
  },
  pendingWork: [],
  recovery: "none" as const,
};

interface Element {
  props?: Record<string, unknown> & { children?: unknown };
}

/** Depth-first walk of a rendered element tree, collecting data-* carriers. */
function collect(
  node: unknown,
  attribute: string,
  found: Element[] = [],
): Element[] {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, attribute, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  const element = node as Element;
  const props = element.props;
  if (props && attribute in props) found.push(element);
  if (props?.children !== undefined) collect(props.children, attribute, found);
  return found;
}

/** The ONE element carrying `attribute="value"` (fails loudly on drift). */
function one(node: unknown, attribute: string, value: string): Element {
  const found = collect(node, attribute).filter(
    (element) => element.props![attribute] === value,
  );
  expect(found, `${attribute}="${value}"`).toHaveLength(1);
  return found[0]!;
}

function mount(
  onDispatch: (submit: PeerControllerStagingSubmit) => void,
  seatHeld = true,
  initialStaging?: unknown,
) {
  const props = {
    capabilities: CAPABILITIES,
    lanePicker: { kind: "ready" as const, keys: [...LANES] },
    seatHeld,
    binding: null,
    roster: [],
    state: { kind: "idle" as const },
    onDispatch,
  };
  function render(): unknown {
    hooks.cursor = 0;
    return (
      PeerControllerPanel as unknown as (input: typeof props) => ReactElement
    )(props);
  }
  if (initialStaging !== undefined) {
    hooks.cursor = 0;
    hooks.states[0] = initialStaging;
  }
  return { render };
}

const change = (element: Element, value: string) =>
  (element.props!.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });

const isDisabled = (element: Element): boolean =>
  element.props!.disabled === true || element.props!.disabled === "";

const field = (node: unknown, name: string): Element => {
  const found = collect(node, "data-control-field").filter(
    (element) => element.props!["data-control-field"] === name,
  );
  expect(found, name).toHaveLength(1);
  return found[0]!;
};

const dispatchButton = (node: unknown): Element =>
  one(node, "data-control-action", "dispatch");

beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});

describe("peer controller console — the operator OWNS the staging inputs", () => {
  it("starts with an empty brief and NO chosen lane, so Dispatch is disabled", () => {
    const tree = mount(vi.fn()).render();
    // Editable, controlled, and empty — never a caller-held readOnly value.
    expect(field(tree, "brief").props!.value).toBe("");
    expect(field(tree, "brief").props!.readOnly).toBeUndefined();
    expect(field(tree, "title").props!.value).toBe("");
    expect(one(tree, "data-lane-picker", "ready").props!.value).toBe("");
    expect(isDisabled(dispatchButton(tree))).toBe(true);
  });

  it("types a brief AND chooses a lane => Dispatch enables, ONE frame carries both", () => {
    const calls: PeerControllerStagingSubmit[] = [];
    const harness = mount((submit) => calls.push(submit));

    // 1) the operator chooses an ADVERTISED lane (the picker is controlled)...
    change(one(harness.render(), "data-lane-picker", "ready"), "lane-review");
    // 2) ...types a title and a brief...
    change(field(harness.render(), "title"), "diff-review");
    change(field(harness.render(), "brief"), "Review the diff");

    // 3) ...and Dispatch is now ENABLED (it was not before).
    const dispatch = dispatchButton(harness.render());
    expect(isDisabled(dispatch)).toBe(false);

    // 4) activating it hands the CALLER exactly the typed/chosen values...
    (dispatch.props!.onClick as () => void)();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      laneKey: "lane-review",
      brief: "Review the diff",
      title: "diff-review",
    });

    // 5) ...which are exactly ONE `peer/dispatch` frame with those values.
    const submit = calls[0]!;
    const plan = planPeerDispatch({
      acquire: ACQUIRE,
      laneKeys: [...LANES],
      laneKey: submit.laneKey,
      operationId: "op-1",
      seed: { brief: submit.brief, slug: submit.title, prompt: "" },
    });
    expect(plan.kind).toBe("dispatch");
    if (plan.kind !== "dispatch") return;
    expect(plan.params.model).toBe("lane-review");
    expect(plan.params.dispatch).toEqual({
      kind: "new_brief",
      brief: "Review the diff",
      title: "diff-review",
    });
  });

  it("keeps Dispatch disabled until BOTH halves are provided", () => {
    const harness = mount(vi.fn());
    change(one(harness.render(), "data-lane-picker", "ready"), "lane-primary");
    // A lane alone is not enough — the brief is still empty.
    expect(isDisabled(dispatchButton(harness.render()))).toBe(true);

    change(field(harness.render(), "brief"), "   ");
    // Whitespace is not a brief either.
    expect(isDisabled(dispatchButton(harness.render()))).toBe(true);

    change(field(harness.render(), "brief"), "Review the diff");
    expect(isDisabled(dispatchButton(harness.render()))).toBe(false);
  });

  it("sends NOTHING when the seat is not held, even with a full staging", () => {
    const calls: PeerControllerStagingSubmit[] = [];
    const harness = mount((submit) => calls.push(submit), false, {
      lane: "lane-primary",
      brief: "Review the diff",
      title: "diff-review",
    });
    const dispatch = dispatchButton(harness.render());
    expect(isDisabled(dispatch)).toBe(true);
    // And a click that somehow reached the button still sends nothing.
    (dispatch.props!.onClick as () => void)();
    expect(calls).toHaveLength(0);
  });

  it("drops a staged lane the picker no longer advertises", () => {
    const harness = mount(vi.fn(), true, {
      lane: "lane-review",
      brief: "Review the diff",
      title: "",
    });
    // lane-review is still advertised here: the pick holds and Dispatch is live.
    expect(isDisabled(dispatchButton(harness.render()))).toBe(false);
    expect(
      one(harness.render(), "data-lane-picker", "ready").props!.value,
    ).toBe("lane-review");
  });
});

describe("PeerControllerPanel source — owned state, one writer", () => {
  const source = readFileSync(
    new URL("./PeerControllerPanel.tsx", import.meta.url),
    "utf8",
  );

  it("holds lane/brief/title as controlled state, never caller props", () => {
    expect(source).toContain("useState<PeerControllerStaging>");
    expect(source).toContain("applyPeerControllerEdit");
    // The doc comment names the removed props, so match the JSX usage.
    expect(source).not.toMatch(/readOnly=\{/);
    expect(source).not.toMatch(/defaultValue=\{/);
  });

  it("reuses the ONE staging module (gate, staged lane, submit)", () => {
    expect(source).toContain("peerControllerStagedLane");
    expect(source).toContain("peerControllerStagingSubmit");
  });
});
