/**
 * FleetView harness — the Start form and row behaviour no browser spec pins
 * (design §4.3, §8). The real-browser chains live in e2e/peer-controller.spec.ts
 * (navigation, Start -> Steer/Approve/Stop, typed refusals) and
 * e2e/native-fleet.spec.ts (native Start without model/session pickers); this
 * file keeps what they cannot reach: the Start state machine against settles
 * the fixture never produces (uncertain ack), the lane-read triage, rows the
 * fixture does not stage (Deny, unsupported control) and the §8 a11y wiring.
 *
 * apps/web has NO jsdom, so this follows the SECOND convention
 * (PeerControllerPanel.harness.test.tsx): `react` is mocked so `useState` is a
 * controllable store, the component is invoked as a plain function, and the
 * returned element tree is walked by data-attribute.
 */
import type { ReactElement } from "react";
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
    readonly nativeStartAvailable?: boolean;
    readonly nativeControlsAvailable?: boolean;
    readonly onGather?: () => void;
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
    fleetPeers: input.peers ?? [],
    nativeStartAvailable: input.nativeStartAvailable ?? false,
    nativeControlsAvailable: input.nativeControlsAvailable ?? false,
    ...(input.onGather ? { onGather: input.onGather } : {}),
    ...(input.onStart ? { onStart: input.onStart } : {}),
    ...(input.onRowAction ? { onRowAction: input.onRowAction } : {}),
    ...(input.selectedSessionId !== undefined
      ? { selectedSessionId: input.selectedSessionId }
      : {}),
    ...(input.laneReadStatus ? { laneReadStatus: input.laneReadStatus } : {}),
  };
  /** Re-render on the SAME hook state; `extra` carries the sink's settle. */
  const render = (extra: Record<string, unknown> = {}): unknown => {
    hooks.cursor = 0;
    return (FleetView as unknown as (p: typeof props) => ReactElement)({
      ...props,
      ...extra,
    });
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

const press = (element: Element) =>
  (element.props!.onClick as (() => void) | undefined)?.();

describe("§4.3 Start — the ONLY implicit acquisition (Round 4 J2)", () => {
  it("opens with a model and a brief, submits once per request, and an accepted settle clears the form for a NEW id", () => {
    const calls: StartSubmit[] = [];
    // Fixes 4210: Start does NOT need a pre-held seat — Start IS the implicit
    // acquisition, so the seat starts released here.
    const harness = mount({
      seatHeld: false,
      selectedSessionId: "coding:local:tui#s1",
      onStart: (submit) => calls.push(submit),
    });
    const blank = harness.render();
    expect(isDisabled(one(blank, "data-fleet-action", "start"))).toBe(true);
    change(one(blank, "data-fleet-field", "model"), "glm-5.3");
    const modelOnly = harness.render();
    expect(isDisabled(one(modelOnly, "data-fleet-action", "start"))).toBe(true);
    change(one(modelOnly, "data-fleet-field", "brief"), "Review the diff");
    const ready = harness.render();
    expect(isDisabled(one(ready, "data-fleet-action", "start"))).toBe(false);
    press(one(ready, "data-fleet-action", "start"));
    // The whole Start identity: the selected session, a minted operation id,
    // the model (lane key) and the brief.
    expect(calls).toEqual([
      {
        sessionId: "coding:local:tui#s1",
        operationId: expect.any(String),
        model: "glm-5.3",
        brief: "Review the diff",
      },
    ]);
    expect(calls[0]!.operationId).not.toBe("");

    // Requesting: "Starting…", disabled, and a second press sends nothing.
    const requesting = harness.render();
    const busy = one(requesting, "data-fleet-action", "start");
    expect(textOf(busy).join("")).toBe("Starting…");
    expect(isDisabled(busy)).toBe(true);
    press(busy);
    expect(calls).toHaveLength(1);

    // The sink reports the dispatch accepted: the idle label returns and the
    // finished brief clears — Start must not stick on "Starting…".
    const accepted = {
      startState: {
        kind: "accepted",
        laneKey: "",
        brief: "",
        operationId: calls[0]!.operationId,
        slug: "op-1",
      },
    };
    const settled = harness.render(accepted);
    expect(textOf(one(settled, "data-fleet-action", "start")).join("")).toBe(
      "Start",
    );
    expect(one(settled, "data-fleet-field", "brief").props!.value).toBe("");

    // The operator's next edit begins a NEW request with a fresh id.
    change(one(settled, "data-fleet-field", "brief"), "Second brief");
    const again = harness.render(accepted);
    expect(isDisabled(one(again, "data-fleet-action", "start"))).toBe(false);
    press(one(again, "data-fleet-action", "start"));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.brief).toBe("Second brief");
    expect(calls[1]!.operationId).not.toBe(calls[0]!.operationId);
  });

  it("a refused Start keeps the draft beside its bounded label; an uncertain one retries with the SAME id", () => {
    const refusedCalls: StartSubmit[] = [];
    const refused = mount({ onStart: (submit) => refusedCalls.push(submit) });
    change(one(refused.render(), "data-fleet-field", "model"), "glm-5.3");
    change(
      one(refused.render(), "data-fleet-field", "brief"),
      "Review the diff",
    );
    press(one(refused.render(), "data-fleet-action", "start"));
    expect(refusedCalls).toHaveLength(1);
    const html = refused.render({
      startState: {
        kind: "failed",
        laneKey: "",
        brief: "",
        operationId: "",
        refusalKind: "driver_model_unavailable",
      },
    });
    const label = one(html, "data-fleet-start-failed", "true");
    // §6: the BOUNDED recovery label, never the typed kind token; the kind
    // stays available as a diagnostic data hook.
    expect(textOf(label).join(" ")).toContain(
      "That model is not configured on this server",
    );
    expect(textOf(label).join(" ")).not.toContain("driver_model_unavailable");
    expect(label.props!["data-refusal-kind"]).toBe("driver_model_unavailable");
    expect(one(html, "data-fleet-field", "brief").props!.value).toBe(
      "Review the diff",
    );

    // No ack within 15 s: Retry resends the SAME operation id (the server
    // replays the duplicate or reports the conflict); Dismiss sends nothing.
    const retryCalls: StartSubmit[] = [];
    const uncertain = mount({ onStart: (submit) => retryCalls.push(submit) });
    const unknown = {
      startState: {
        kind: "unknown",
        laneKey: "glm-5.3",
        brief: "Review the diff",
        operationId: "op-retry-me",
      },
    };
    const notice = uncertain.render(unknown);
    expect(
      textOf(one(notice, "data-fleet-start-unknown", "true")).join(" "),
    ).toContain("Not sure it started");
    press(one(notice, "data-fleet-start-retry", "true"));
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0]!.operationId).toBe("op-retry-me");
    expect(retryCalls[0]!.brief).toBe("Review the diff");
    press(one(uncertain.render(unknown), "data-fleet-start-dismiss", "true"));
    expect(retryCalls).toHaveLength(1);
    expect(
      collect(uncertain.render(unknown), "data-fleet-start-unknown"),
    ).toHaveLength(0);
  });
});

describe("Fixes 4220 — lane-read triage", () => {
  // Why: "not configured" blames the operator's Providers setup, so it may
  // show ONLY after a completed empty read — never while no Session is open
  // (the session-scoped read cannot start) or while the read is in flight
  // (walkthrough 4200b/02+08 blamed Providers for "no session open yet").
  it("no Session hides the form, loading never blames Providers, an empty read links them, lanes render as model names", () => {
    const noSession = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "",
      peerController: null,
    }).render();
    expect(
      textOf(one(noSession, "data-fleet-empty", "true")).join(" "),
    ).toContain("Open a project first");
    expect(collect(noSession, "data-fleet-form")).toHaveLength(0);

    const loading = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "s1",
      laneReadStatus: "loading",
    }).render();
    const loadingNote = one(loading, "data-fleet-lane-status", "loading");
    expect(textOf(loadingNote).join(" ")).toContain("Loading models…");
    expect(textOf(loading).join(" ")).not.toContain("No peer models");
    expect(one(loading, "data-fleet-field", "model").props!.disabled).toBe(
      true,
    );

    const empty = mount({
      lanePicker: { kind: "disabled" },
      selectedSessionId: "s1",
      laneReadStatus: "empty",
    }).render();
    expect(
      textOf(one(empty, "data-fleet-lane-status", "empty")).join(" "),
    ).toContain("No peer models are configured");
    expect(
      one(empty, "data-fleet-providers-link", "true").props!.onClick,
    ).toBeTypeOf("function");

    // Fixes 4210: model NAMES, the lane key only as a disambiguating suffix.
    const ready = mount({
      lanePicker: { kind: "ready", keys: ["glm-53", "kimi-k3"] },
      selectedSessionId: "s1",
    }).render();
    const options = collect(one(ready, "data-fleet-field", "model"), "value")
      .filter(
        (option) =>
          typeof option.props!.value === "string" && option.props!.value !== "",
      )
      .map(
        (option) => `${option.props!.value}=${String(option.props!.children)}`,
      );
    expect(options).toEqual(["glm-53=glm-5.3", "kimi-k3=kimi-k3"]);
  });
});

describe("§4.3 rows", () => {
  it("show identity, the event-derived word, elapsed and tokens, and offer Approve/Deny only while an approval waits", () => {
    const html = mount({
      peers: [
        fleetRow("op-1"),
        // Round 4 C2: no brief title yet — the word comes from events, never
        // the stale "Peer started" placeholder.
        fleetRow("op-2", {
          label: "Peer 2 · glm-5.3",
          title: "Peer started",
        }),
        fleetRow("op-3", {
          label: "Peer 3 · glm-5.3",
          statusWord: "Waiting for your approval",
        }),
      ],
    }).render();
    const working = rowFor(html, "op-1");
    expect(working.props!["data-fleet-status"]).toBe("Working");
    const workingText = textOf(working).join(" | ");
    expect(workingText).toContain("Peer 1 · glm-5.3");
    expect(workingText).toContain("1m");
    expect(workingText).toContain("↓ 120");
    expect(textOf(rowFor(html, "op-2")).join(" ")).not.toMatch(
      /Peer started\b.*Working/,
    );
    // Round 4 C5: Approve/Deny render ONLY while an approval is pending.
    for (const slug of ["op-1", "op-2"])
      for (const action of ["approve", "deny"])
        expect(
          collect(rowFor(html, slug), "data-fleet-action").filter(
            (element) => element.props!["data-fleet-action"] === action,
          ),
        ).toHaveLength(0);
    const waiting = rowFor(html, "op-3");
    for (const action of ["approve", "deny", "steer", "stop"])
      expect(one(waiting, "data-fleet-action", action).props!.type).toBe(
        "button",
      );
    expect(
      one(waiting, "data-fleet-action", "stop").props!.disabled,
    ).toBeUndefined();
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
  it("rows are named, the polite region announces a waiting peer, and disabled reasons and the steer box are labelled", () => {
    const html = mount({
      peers: [fleetRow("op-1", { statusWord: "Waiting for your approval" })],
    }).render();
    expect(rowFor(html, "op-1").props!["aria-label"]).toBe(
      "Peer 1 · glm-5.3, waiting for your approval, Review the diff",
    );
    // The polite region must CARRY the announcement text, not be an empty div.
    expect(textOf(collect(html, "aria-live")[0]!).join("")).toContain(
      "Peer 1 · glm-5.3 is waiting for your approval",
    );
    // Every disabled action's describedby points at a REAL element id.
    const described = collect(html, "aria-describedby");
    expect(described.length).toBeGreaterThanOrEqual(1);
    const ids = new Set(collect(html, "id").map((e) => String(e.props!.id)));
    for (const element of described) {
      const target = String(element.props!["aria-describedby"]);
      expect(ids, target).toContain(target);
    }
    const steer = one(html, "data-fleet-field", "steer-op-1");
    expect(steer.props!["aria-label"]).toBe("Enter steering text");
    expect(steer.props!.placeholder).toBe("Enter steering text");
  });
});
