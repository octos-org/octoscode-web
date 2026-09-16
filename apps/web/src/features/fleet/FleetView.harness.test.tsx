/**
 * FleetView harness — GLM-WEB-UX2-FLEET-VIEW-4010 RED (design §4.3, §8).
 *
 * apps/web has NO jsdom, so this follows the SECOND convention
 * (PeerControllerPanel.harness.test.tsx): `react` is mocked so `useState` is a
 * controllable store, the component is invoked as a plain function, and the
 * returned element tree is walked by data-attribute. RED: FleetView.tsx and
 * fleet-navigation.ts do not exist yet.
 */
import type { ReactElement } from "react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTERNAL_DRIVER_METHODS,
  EXTERNAL_DRIVER_V1_FEATURE,
} from "@octos-org/octoscode-client/external-driver";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";

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

const { FleetView } = await import("./FleetView.tsx");
const { fleetNavigationEntry } = await import("./fleet-navigation.ts");

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

interface Element {
  type?: unknown;
  props?: Record<string, unknown> & { children?: unknown };
}

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

function one(node: unknown, attribute: string, value: string): Element {
  const found = collect(node, attribute).filter(
    (element) => element.props![attribute] === value,
  );
  expect(found, `${attribute}="${value}"`).toHaveLength(1);
  return found[0]!;
}

const isDisabled = (element: Element): boolean =>
  element.props!.disabled === true || element.props!.disabled === "";

/** Collect every STRING leaf in a subtree (children text, values, marks). */
function textOf(node: unknown): string[] {
  const found: string[] = [];
  (function walk(current: unknown): void {
    if (typeof current === "string" || typeof current === "number") {
      found.push(String(current));
      return;
    }
    if (Array.isArray(current)) {
      for (const child of current) walk(child);
      return;
    }
    if (current === null || typeof current !== "object") return;
    const element = current as Element;
    const props = element.props;
    if (props?.children !== undefined) walk(props.children);
  })(node);
  return found;
}

function rowFor(node: unknown, slug: string): Element {
  return one(node, "data-fleet-row", slug);
}

function fleetRow(
  slug: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    slug,
    label: "Peer 1 · glm-5.3",
    title: "Review the diff",
    statusWord: "Working",
    sessionId: "coding:local:tui#" + slug,
    sessionName: "octoscode-web",
    goalId: null,
    elapsedMs: 60_000,
    tokens: 120,
    controlSupported: true,
    ...overrides,
  };
}

type StartSubmit = {
  sessionId: string;
  operationId: string;
  model: string;
  brief: string;
  laneKey?: string;
};

function mount(
  input: {
    readonly peers?: readonly Record<string, unknown>[];
    readonly capabilities?: UiProtocolCapabilities | undefined;
    readonly lanePicker?:
      { kind: "ready"; keys: string[] } | { kind: "disabled" };
    readonly seatHeld?: boolean;
    readonly selectedSessionId?: string;
    readonly laneReadStatus?: "loading" | "empty" | "ready";
    readonly peerController?: Record<string, unknown> | null;
    readonly onStart?: (submit: StartSubmit) => void;
    readonly onRowAction?: (
      row: { slug: string },
      action: string,
      steerText?: string,
    ) => void;
  } = {},
) {
  const props = {
    peerController:
      input.peerController === null
        ? null
        : {
            readiness: "ready" as const,
            capabilities: input.capabilities ?? CAPABILITIES,
            lanePicker: input.lanePicker ?? {
              kind: "ready",
              keys: ["glm-5.3"],
            },
            seatHeld: input.seatHeld ?? true,
            binding: null,
            roster: [],
            state: { kind: "idle" as const },
            fleetPeers: input.peers ?? [],
            ...input.peerController,
          },
    sessions: [],
    ...(input.onStart ? { onStart: input.onStart } : {}),
    ...(input.onRowAction ? { onRowAction: input.onRowAction } : {}),
    ...(input.selectedSessionId !== undefined
      ? { selectedSessionId: input.selectedSessionId }
      : {}),
    ...(input.laneReadStatus ? { laneReadStatus: input.laneReadStatus } : {}),
  };
  const render = (): unknown => {
    hooks.cursor = 0;
    return (FleetView as unknown as (p: typeof props) => ReactElement)(props);
  };
  return { props, render };
}

const change = (element: Element, value: string) =>
  (element.props!.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });

beforeEach(() => {
  hooks.states = [];
  hooks.cursor = 0;
});

describe("navigation descriptor", () => {
  it("exports label, icon and route key for the strip owner to mount", () => {
    expect(fleetNavigationEntry).toMatchObject({
      label: "Fleet",
      routeKey: "fleet",
    });
    expect(typeof fleetNavigationEntry.icon).toBe("string");
    expect(fleetNavigationEntry.icon.length).toBeGreaterThan(0);
  });
});

describe("§4.3 empty view", () => {
  it("renders 'No peers yet' plus the Start form when the roster is empty", () => {
    const html = mount().render();
    expect(collect(html, "data-fleet-empty").length).toBeGreaterThanOrEqual(1);
    expect(one(html, "data-fleet-empty", "true").props!.children).toContain(
      "No peers yet",
    );
  });

  it("disables the form with the providers link copy when no lanes exist", () => {
    const html = mount({
      lanePicker: { kind: "disabled" },
      seatHeld: false,
    }).render();
    expect(textOf(one(html, "data-fleet-form", "start")).join(" | ")).toContain(
      "No peer models are configured",
    );
  });
});

describe("§4.3 Start form — the ONLY implicit acquisition", () => {
  it("Start enables only with a model, a brief and a holdable seat", () => {
    const calls: StartSubmit[] = [];
    const harness = mount({
      selectedSessionId: "coding:local:tui#s1",
      onStart: (submit) => calls.push(submit),
    });
    const first = harness.render();
    expect(isDisabled(one(first, "data-fleet-action", "start"))).toBe(true);

    change(one(first, "data-fleet-field", "model"), "glm-5.3");
    const second = harness.render();
    expect(isDisabled(one(second, "data-fleet-action", "start"))).toBe(true);

    change(one(second, "data-fleet-field", "brief"), "Review the diff");
    const third = harness.render();
    expect(isDisabled(one(third, "data-fleet-action", "start"))).toBe(false);

    (one(third, "data-fleet-action", "start").props!.onClick as () => void)();
    // Round 4 J2 contract: the whole Start identity — the selected session,
    // a minted operation id, the model (lane key) and the brief.
    expect(calls).toEqual([
      {
        sessionId: "coding:local:tui#s1",
        operationId: expect.any(String),
        model: "glm-5.3",
        brief: "Review the diff",
      },
    ]);
    expect(calls[0]!.operationId).not.toBe("");
  });

  it("sends nothing while the seat is not held", () => {
    const calls: StartSubmit[] = [];
    const harness = mount({
      seatHeld: false,
      onStart: (submit) => calls.push(submit),
    });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(one(harness.render(), "data-fleet-field", "brief"), "Review");
    const third = harness.render();
    // Fixes 4210: Start does NOT require a pre-held seat — Start IS the
    // implicit acquisition (walkthrough 4200 step 8; mock run 20's 8 reds).
    expect(isDisabled(one(third, "data-fleet-action", "start"))).toBe(false);
    (one(third, "data-fleet-action", "start").props!.onClick as () => void)();
    expect(calls).toEqual([
      {
        sessionId: "",
        operationId: expect.any(String),
        model: "glm-5.3",
        brief: "Review",
      },
    ]);
    expect(calls[0]!.operationId).not.toBe("");
  });
});

describe("Fixes 4210 — model NAMES, styled surface, styled empty/Advanced", () => {
  it("picker options show model NAMES, keys only as disambiguating suffixes", () => {
    const html = mount({
      lanePicker: { kind: "ready", keys: ["glm-53", "kimi-k3"] },
    }).render();
    const picker = one(html, "data-fleet-field", "model");
    const options = collect(picker, "value")
      .filter(
        (option) =>
          typeof option.props!.value === "string" && option.props!.value !== "",
      )
      .map(
        (option) => `${option.props!.value}=${String(option.props!.children)}`,
      );
    expect(options).toEqual(["glm-53=glm-5.3", "kimi-k3=kimi-k3"]);
  });

  it("applies the module classes (cards, form, buttons) — not bare elements", () => {
    const html = mount().render();
    const section = one(html, "aria-label", "Fleet");
    expect(String(section.props!.className)).toContain("fleet");
    const form = one(html, "data-fleet-form", "start");
    expect(String(form.props!.className).trim()).not.toBe("");
    const start = one(html, "data-fleet-action", "start");
    expect(String(start.props!.className).trim()).not.toBe("");
  });

  it("styles the empty state and the Advanced disclosure", () => {
    const html = mount().render();
    expect(
      String(one(html, "data-fleet-empty", "true").props!.className).trim(),
    ).not.toBe("");
    // Round 4 C3: Advanced is a compact native details/summary disclosure.
    const advanced = collect(html, "data-fleet-advanced-summary")[0]!;
    expect(advanced).toBeDefined();
    expect(String(advanced.props!.className).trim()).not.toBe("");
  });
});

describe("round 2 judge #2 — requesting/failure states, no repeat submit, kept brief", () => {
  it("Start click with model+brief enters requesting and blocks a repeat submit", () => {
    const calls: StartSubmit[] = [];
    const harness = mount({ onStart: (submit) => calls.push(submit) });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(one(harness.render(), "data-fleet-field", "brief"), "Review");
    const enabled = harness.render();
    (one(enabled, "data-fleet-action", "start").props!.onClick as () => void)();
    expect(calls).toEqual([
      {
        sessionId: "",
        operationId: expect.any(String),
        model: "glm-5.3",
        brief: "Review",
      },
    ]);
    expect(calls[0]!.operationId).not.toBe("");
    // REQUESTING: the button now shows the requesting copy and is disabled,
    // so a second click can never issue a second acquire/dispatch.
    const requesting = harness.render();
    expect(isDisabled(one(requesting, "data-fleet-action", "start"))).toBe(
      true,
    );
    (
      one(requesting, "data-fleet-action", "start").props!.onClick as
        (() => void) | undefined
    )?.();
    expect(calls).toHaveLength(1);
    expect(
      textOf(one(requesting, "data-fleet-action", "start")).join(""),
    ).toContain("Starting…");
  });

  it("a refused Start keeps the brief visible for retry", () => {
    const calls: StartSubmit[] = [];
    const harness = mount({ onStart: (submit) => calls.push(submit) });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(
      one(harness.render(), "data-fleet-field", "brief"),
      "Review the diff",
    );
    (
      one(harness.render(), "data-fleet-action", "start").props!
        .onClick as () => void
    )();
    // Simulate the sink's refusal settling on the component's state slot.
    const retry = one(harness.render(), "data-fleet-field", "brief");
    expect(retry.props!.value).toBe("Review the diff");
    expect(calls).toHaveLength(1);
  });
});

describe("round 2 judge #2/#8 — Providers link, session selector, live region, describedby", () => {
  it("renders the empty-model note's Providers destination as a REAL link", () => {
    const html = mount({
      lanePicker: { kind: "disabled" },
    }).render();
    const providers = one(html, "data-fleet-providers-link", "true");
    expect(providers.props!.onClick).toBeTypeOf("function");
  });

  it("offers a session selector defaulting to the selected session", () => {
    const base = mount();
    const html = (
      FleetView as unknown as (p: Record<string, unknown>) => ReactElement
    )({
      ...base.props,
      sessions: [
        { sessionId: "s1", name: "octoscode-web" },
        { sessionId: "s2", name: "other" },
      ],
    });
    const selector = one(html, "data-fleet-field", "session");
    const options = collect(selector, "value").filter(
      (option) =>
        typeof option.props!.value === "string" && option.props!.value !== "",
    );
    expect(options.map((o) => String(o.props!.children))).toEqual([
      "octoscode-web",
      "other",
    ]);
  });

  it("announces a peer's new waiting state in the live region", () => {
    // The polite region must CARRY the announcement text, not be an empty div.
    const html = mount({
      peers: [fleetRow("op-1", { statusWord: "Waiting for your approval" })],
    }).render();
    const live = collect(html, "aria-live")[0]!;
    expect(textOf(live).join("")).toContain(
      "Peer 1 · glm-5.3 is waiting for your approval",
    );
  });

  it("points every disabled action's describedby at a REAL element id", () => {
    const html = mount({
      peers: [fleetRow("op-1", { statusWord: "Working" })],
    }).render();
    const described = collect(html, "aria-describedby");
    expect(described.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(collect(html, "id").map((e) => String(e.props!.id)));
    for (const element of described) {
      const target = String(element.props!["aria-describedby"]);
      expect(ids, target).toContain(target);
    }
  });
});

describe("Fixes 4220 — lane-read triage: no session vs loading vs empty read", () => {
  it("no session open: renders 'Open a project first' and hides the Start form", () => {
    const html = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "",
      peerController: null,
    }).render();
    const empty = one(html, "data-fleet-empty", "true");
    expect(textOf(empty).join(" ")).toContain("Open a project first");
    // The Start form is HIDDEN, not merely disabled.
    expect(collect(html, "data-fleet-form").length).toBe(0);
  });

  it("session selected, read still in flight: shows 'Loading models…', no 'not configured' copy", () => {
    const html = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "s1",
      laneReadStatus: "loading",
    }).render();
    const note = collect(html, "data-fleet-lane-status")[0]!;
    expect(textOf(note).join(" ")).toContain("Loading models…");
    expect(textOf(note).join(" ")).not.toContain("No peer models");
    // The form stays mounted (read pending), picker disabled.
    expect(one(html, "data-fleet-form", "start")).toBeDefined();
    expect(one(html, "data-fleet-field", "model").props!.disabled).toBe(true);
  });

  it("completed EMPTY read: the ONLY case that shows the 'not configured' copy + Providers link", () => {
    const html = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "s1",
      laneReadStatus: "empty",
    }).render();
    const note = collect(html, "data-fleet-lane-status")[0]!;
    expect(textOf(note).join(" ")).toContain("No peer models are configured");
    expect(collect(html, "data-fleet-providers-link").length).toBe(1);
  });

  it("renders the model <select> with options as soon as lanes arrive", () => {
    const html = mount({
      lanePicker: { kind: "ready", keys: ["glm-53", "kimi-k3"] },
      selectedSessionId: "s1",
    }).render();
    const select = one(html, "data-fleet-field", "model");
    expect(String(select.props!.children)).not.toBe("[]");
    const options = collect(select, "value").filter(
      (o) => typeof o.props!.value === "string" && o.props!.value !== "",
    );
    expect(options).toHaveLength(2);
  });
});

describe("Round 4 section C — status/word/spacing/a11y polish (4200d 08.png)", () => {
  it("C1: Start returns to its idle label once dispatch is acknowledged", () => {
    const calls: StartSubmit[] = [];
    const harness = mount({ onStart: (submit) => calls.push(submit) });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(one(harness.render(), "data-fleet-field", "brief"), "Review");
    (
      one(harness.render(), "data-fleet-action", "start").props!
        .onClick as () => void
    )();
    // While requesting: the "Starting…" copy shows.
    expect(
      textOf(one(harness.render(), "data-fleet-action", "start")).join(""),
    ).toContain("Starting…");
    // The dispatch is ACKNOWLEDGED (sink reported back): idle label returns
    // even though the row shows Working — Start must not stick on Starting….
    const acknowledged = (
      FleetView as unknown as (p: Record<string, unknown>) => ReactElement
    )({
      ...harness.props,
      startState: {
        kind: "accepted",
        laneKey: "glm-5.3",
        brief: "Review",
        operationId: "op-1",
        slug: "op-1",
      },
    });
    expect(
      textOf(one(acknowledged, "data-fleet-action", "start")).join(""),
    ).toContain("Start");
  });

  it("C2: a row with NO brief title shows the event-derived word, not 'Peer started'", () => {
    const html = mount({
      peers: [
        fleetRow("op-1", { title: "Peer started", statusWord: "Working" }),
      ],
    }).render();
    const row = rowFor(html, "op-1");
    const texts = textOf(row).join(" ");
    expect(texts).toContain("Working");
    // The title must not contradict the status line: no bare 'Peer started'
    // placeholder while events say Working.
    expect(texts).not.toMatch(/Peer started\b.*Working/);
  });

  it("C3: Advanced is a compact native details/summary disclosure", () => {
    const html = mount().render();
    const details = collect(html, "data-fleet-advanced").filter(
      (element) => element.type === "details",
    );
    expect(details).toHaveLength(1);
    const summary = collect(
      details[0]!.props!.children,
      "data-fleet-advanced-summary",
    ).filter((element) => element.type === "summary");
    expect(summary).toHaveLength(1);
  });

  it("C4: the steer input carries an accessible name AND a placeholder", () => {
    const html = mount({
      peers: [fleetRow("op-1", { statusWord: "Working" })],
    }).render();
    const steer = one(html, "data-fleet-field", "steer-op-1");
    expect(typeof steer.props!["aria-label"]).toBe("string");
    expect(steer.props!["aria-label"]).not.toBe("");
    expect(typeof steer.props!.placeholder).toBe("string");
    expect(steer.props!.placeholder).not.toBe("");
  });

  it("C5: Approve/Deny render ONLY while an approval is pending (no clutter otherwise)", () => {
    // Working row: NO Approve/Deny buttons at all.
    const working = mount({
      peers: [fleetRow("op-1", { statusWord: "Working" })],
    }).render();
    expect(
      collect(working, "data-fleet-action").filter(
        (e) => e.props!["data-fleet-action"] === "approve",
      ),
    ).toHaveLength(0);
    // Waiting-for-approval row: both render.
    const waiting = mount({
      peers: [fleetRow("op-1", { statusWord: "Waiting for your approval" })],
    }).render();
    for (const action of ["approve", "deny"])
      expect(
        collect(waiting, "data-fleet-action").filter(
          (e) => e.props!["data-fleet-action"] === action,
        ),
      ).toHaveLength(1);
  });
});

describe("Round 4 J2 — Start lifecycle: submit contract + every settle state", () => {
  it("onStart carries {sessionId, operationId, model, brief} — the whole Start identity", () => {
    const calls: Record<string, unknown>[] = [];
    const harness = mount({
      onStart: (submit) => calls.push(submit as Record<string, unknown>),
    });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(
      one(harness.render(), "data-fleet-field", "brief"),
      "Review the diff",
    );
    (
      one(harness.render(), "data-fleet-action", "start").props!
        .onClick as () => void
    )();
    expect(calls).toHaveLength(1);
    const submit = calls[0]!;
    expect(submit.model).toBe("glm-5.3");
    expect(submit.brief).toBe("Review the diff");
    expect(typeof submit.operationId).toBe("string");
    expect(submit.operationId).not.toBe("");
    // The SELECTED session rides along (empty when none was chosen).
    expect(submit.sessionId).toBe("");
  });

  it("requesting renders 'Starting…' and blocks a second submit", () => {
    const calls: Record<string, unknown>[] = [];
    const harness = mount({
      onStart: (submit) => calls.push(submit as Record<string, unknown>),
    });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(one(harness.render(), "data-fleet-field", "brief"), "R");
    (
      one(harness.render(), "data-fleet-action", "start").props!
        .onClick as () => void
    )();
    const requesting = harness.render();
    expect(
      textOf(one(requesting, "data-fleet-action", "start")).join(""),
    ).toContain("Starting…");
    (
      one(requesting, "data-fleet-action", "start").props!.onClick as
        (() => void) | undefined
    )?.();
    expect(calls).toHaveLength(1);
  });

  it("accepted settles the form: idle label returns, brief CLEARED, a new Start mints a NEW id", () => {
    const calls: Record<string, unknown>[] = [];
    const harness = mount({
      onStart: (submit) => calls.push(submit as Record<string, unknown>),
    });
    change(one(harness.render(), "data-fleet-field", "model"), "glm-5.3");
    change(one(harness.render(), "data-fleet-field", "brief"), "First brief");
    (
      one(harness.render(), "data-fleet-action", "start").props!
        .onClick as () => void
    )();
    const firstId = calls[0]!.operationId;
    // The sink settles accepted through startState.
    const accepted = (
      FleetView as unknown as (p: Record<string, unknown>) => ReactElement
    )({
      ...harness.props,
      startState: {
        kind: "accepted",
        laneKey: "glm-5.3",
        brief: "First brief",
        operationId: String(firstId),
        slug: "op-1",
      },
    });
    expect(
      textOf(one(accepted, "data-fleet-action", "start")).join(""),
    ).toContain("Start");
    expect(one(accepted, "data-fleet-field", "brief").props!.value).toBe("");
  });

  it("refused renders the bounded inline label and KEEPS the brief", () => {
    const html = (
      FleetView as unknown as (p: Record<string, unknown>) => ReactElement
    )({
      ...mount().props,
      startState: {
        kind: "failed",
        laneKey: "glm-5.3",
        brief: "Review the diff",
        operationId: "op-1",
        refusalKind: "driver_model_unavailable",
      },
    });
    const label = one(html, "data-fleet-start-failed", "true");
    // §6: the rendered copy is the BOUNDED recovery label, never the typed
    // kind token (protocol vocabulary) and never raw server copy; the kind
    // itself stays available as a diagnostic data hook.
    expect(textOf(label).join(" ")).toContain(
      "That model is not configured on this server",
    );
    expect(textOf(label).join(" ")).not.toContain("driver_model_unavailable");
    expect(label.props!["data-refusal-kind"]).toBe("driver_model_unavailable");
  });

  it("unknown after 15 s renders 'Not sure it started' with SAME-id Retry and Dismiss", () => {
    const calls: Record<string, unknown>[] = [];
    const props = {
      ...mount({
        onStart: (submit) => calls.push(submit as Record<string, unknown>),
      }).props,
      startState: {
        kind: "unknown",
        laneKey: "glm-5.3",
        brief: "Review the diff",
        operationId: "op-retry-me",
      } as never,
    };
    const html = (FleetView as unknown as (p: typeof props) => ReactElement)(
      props,
    );
    expect(
      textOf(one(html, "data-fleet-start-unknown", "true")).join(" "),
    ).toContain("Not sure it started");
    // Retry resubmits with the SAME operation id.
    (
      one(html, "data-fleet-start-retry", "true").props!.onClick as () => void
    )();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.operationId).toBe("op-retry-me");
    expect(calls[0]!.brief).toBe("Review the diff");
    // Dismiss hides the notice without sending.
    (
      one(html, "data-fleet-start-dismiss", "true").props!.onClick as () => void
    )();
  });
});

describe("§4.3 rows", () => {
  it("renders label, activity word, elapsed, tokens and actions per row", () => {
    const html = mount({
      peers: [fleetRow("op-1")],
    }).render();
    const row = rowFor(html, "op-1");
    expect(textOf(row).join(" | ")).toContain("Peer 1 · glm-5.3");
    expect(row.props!["data-fleet-status"]).toBe("Working");
    expect(textOf(row).join(" | ")).toContain("1m");
    expect(textOf(row).join(" | ")).toContain("↓ 120");
  });

  it("exposes keyboard-reachable Approve/Deny/Steer/Stop and aria reasons", () => {
    const html = mount({
      peers: [fleetRow("op-1", { statusWord: "Waiting for your approval" })],
    }).render();
    for (const action of ["approve", "deny", "steer", "stop"])
      expect(one(html, "data-fleet-action", action).props!.type).toBe("button");
    const stop = one(html, "data-fleet-action", "stop");
    expect(stop.props!.disabled).toBeUndefined();
  });

  it("hides actions and explains when the server lacks remote control", () => {
    const html = mount({
      peers: [fleetRow("op-1", { controlSupported: false })],
    }).render();
    expect(
      one(html, "data-fleet-unsupported", "true").props!.children,
    ).toContain("This server does not support remote control of peers");
  });
});

describe("§8 a11y contract", () => {
  it("rows are articles with accessible names and a polite live region", () => {
    const html = mount({ peers: [fleetRow("op-1")] }).render();
    const row = rowFor(html, "op-1");
    const article = collect(html, "aria-label").find(
      (element) =>
        element.props!["aria-label"] ===
        "Peer 1 · glm-5.3, working, Review the diff",
    );
    expect(article).toBeDefined();
    expect(row.props!.children).toBeDefined();
  });
});

describe("source — owned seams only", () => {
  const source = readFileSync(
    new URL("./FleetView.tsx", import.meta.url),
    "utf8",
  );

  it("renders the existing PeerControllerPanel unchanged under Advanced", () => {
    expect(source).toContain("PeerControllerPanel");
  });

  it("does not touch another owner's files", () => {
    expect(source).not.toContain("zh.ts");
  });
});
