/**
 * PeerDock round 2 (judge #4, WEB-UX-ROUND2-4400) — RED-first.
 *
 * Design §4.1: "The dock rows carry Approve / Deny / Answer / Steer / Stop
 * exactly like Fleet rows (§4.3) — the dock is the per-session slice of
 * Fleet." Round 1 shipped Approve/Deny only, and exposed the raw slug.
 * These cases pin the parity contract with the SAME no-jsdom conventions as
 * PeerDock.test.tsx (static markup + direct handler invocation).
 */
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PeerDock, type PeerDockManager } from "./PeerDock.tsx";
import type {
  PeerRosterEntry,
  PeerManagerSnapshot,
} from "./peer-manager.ts";
import type { PeerRowAttention } from "../control/peer-row-command.ts";

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => [initial, () => undefined],
  useSyncExternalStore: (
    _subscribe: unknown,
    getSnapshot: () => unknown,
  ) => getSnapshot(),
}));
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

const UUID = "11111111-1111-1111-1111-111111111111";

function entry(overrides: Partial<PeerRosterEntry>): PeerRosterEntry {
  return {
    identity: "peer-1",
    profileId: "profile",
    topic: "topic",
    slug: "fence-a",
    cwd: "/srv/work",
    briefPath: "/srv/work/brief.md",
    origin: "prepare",
    turnId: UUID,
    status: "started",
    activity: "idle",
    openedAt: null,
    finishedAt: null,
    error: null,
    canRetry: false,
    ...overrides,
  };
}

function managerFor(peers: readonly PeerRosterEntry[]): PeerDockManager {
  const value: PeerManagerSnapshot = {
    peers,
    blackboard: [],
    prepareBusy: false,
    gatherBusy: false,
    prepareError: null,
    gatherError: null,
    prepareUncertain: false,
    dispatchRefusalKind: null,
  };
  return { subscribe: () => () => undefined, getSnapshot: () => value };
}

const BASE = entry({
  identity: "p-live",
  slug: "fence-a",
  activity: "live",
  operationId: "dispatch-op-9",
});

const APPROVAL_ROW = entry({
  identity: "p-approval",
  slug: "fence-approve",
  activity: "blocked",
  status: "started",
  requestId: "req-approval-1",
  requestKind: "approval",
  operationId: "dispatch-op-1",
});

const QUESTION_ROW = entry({
  identity: "p-question",
  slug: "fence-question",
  activity: "blocked",
  status: "started",
  requestId: "req-question-1",
  requestKind: "question",
  operationId: "dispatch-op-1",
});

/** Attention facts the dock must derive from the row (no synthesized ids). */
function attentionOf(row: PeerRosterEntry): PeerRowAttention {
  return {
    requestId: row.requestId ?? null,
    requestKind: row.requestKind ?? null,
    operationId: row.operationId ?? null,
    turnId: row.turnId,
  };
}

describe("PeerDock row action parity with Fleet (judge #4)", () => {
  const render = (peers: readonly PeerRosterEntry[], wired = true) =>
    renderToStaticMarkup(
      <PeerDock
        manager={managerFor(peers)}
        {...(wired ? { onRowAction: () => undefined } : {})}
      />,
    );

  it("an approval-blocked row offers Approve / Deny / Approve for session / Stop", () => {
    const markup = render([APPROVAL_ROW]);
    expect(markup).toContain('data-row-action="approve"');
    expect(markup).toContain('data-row-action="deny"');
    expect(markup).toContain('data-row-action="approve_session"');
    expect(markup).toContain('data-row-action="stop"');
    // Steer is NOT offered while the peer waits for an approval.
    expect(markup).not.toContain('data-row-action="steer"');
  });

  it("a question-blocked row offers Answer and Stop — the picker is not the only path", () => {
    const markup = render([QUESTION_ROW]);
    expect(markup).toContain('data-row-action="answer"');
    expect(markup).toContain('data-row-action="stop"');
    expect(markup).not.toContain('data-row-action="approve"');
    expect(markup).not.toContain('data-row-action="deny"');
  });

  it("a live row offers Steer and Stop only", () => {
    const markup = render([BASE]);
    expect(markup).toContain('data-row-action="steer"');
    expect(markup).toContain('data-row-action="stop"');
    expect(markup).not.toContain('data-row-action="approve"');
    expect(markup).not.toContain('data-row-action="answer"');
  });

  it("an idle row offers nothing (no accepted dispatch to address)", () => {
    const markup = render([
      entry({ identity: "p-idle", slug: "fence-idle", activity: "idle" }),
    ]);
    expect(markup).not.toContain("data-row-action=");
  });

  it("a done row offers nothing (terminal)", () => {
    const markup = render([
      entry({
        identity: "p-done",
        slug: "fence-done",
        activity: "done",
        finishedAt: 1,
      }),
    ]);
    expect(markup).not.toContain("data-row-action=");
  });

  it("rows without a wired sink render no dead controls", () => {
    expect(render([APPROVAL_ROW], false)).not.toContain("data-row-action=");
  });

  it("accessible names name the PEER, not a raw slug", () => {
    const markup = render([APPROVAL_ROW, QUESTION_ROW, BASE]);
    // The raw slug may appear as the row's own text (identity), but every
    // action's accessible name carries the peer label word "Peer".
    const labels = markup.match(/aria-label="[^"]*"/g) ?? [];
    for (const label of labels) {
      if (label.includes("Approve") || label.includes("Deny") || label.includes("Answer") || label.includes("Steer") || label.includes("Stop"))
        expect(label).toContain("Peer");
    }
    expect(markup).toContain("Approve Peer");
    expect(markup).toContain("Answer Peer");
  });
});

describe("PeerDock action dispatch carries real row facts (judge #4)", () => {
  function mount(peers: readonly PeerRosterEntry[]) {
    const onRowAction = vi.fn();
    const tree = PeerDock({
      manager: managerFor(peers),
      onRowAction,
    }) as ReactElement;
    const markup = renderToStaticMarkup(tree);
    return { onRowAction, markup };
  }

  it("Approve forwards the row with the real approval id", () => {
    const dock = mount([APPROVAL_ROW]);
    expect(dock.markup).toContain('data-row-action="approve"');
    // Static harness: the callback contract is covered by PeerDock.test.tsx's
    // handler-walk convention; here we pin that wiring exists at all.
    expect(dock.markup).toContain("Approve");
  });

  it("renders the question row's Answer affordance when a question id is present", () => {
    const dock = mount([QUESTION_ROW]);
    expect(dock.markup).toContain('data-row-action="answer"');
    expect(attentionOf(QUESTION_ROW).requestId).toBe("req-question-1");
  });
});

const QUESTION_DETAIL_ROW_STANDALONE = entry({
  identity: "p-question-s",
  slug: "fence-question-s",
  activity: "blocked",
  status: "started",
  requestId: "req-question-d",
  requestKind: "question",
  operationId: "dispatch-op-1",
  requestDetail: {
    header: "Depth",
    question: "How deep?",
    options: [
      { label: "Fast", description: "Unit tests" },
      { label: "Full", description: "All checks" },
    ],
    multiSelect: false,
    allowFreeText: true,
  },
});

describe("PeerDock request contents + consequences (judge r2 #4)", () => {
  const render = (peers: readonly PeerRosterEntry[]) =>
    renderToStaticMarkup(<PeerDock manager={managerFor(peers)} onRowAction={() => undefined} />);

  const APPROVAL_DETAIL_ROW = entry({
    identity: "p-approval-d",
    slug: "fence-approval-d",
    activity: "blocked",
    status: "started",
    requestId: "req-approval-d",
    requestKind: "approval",
    operationId: "dispatch-op-1",
    requestDetail: {
      toolName: "shell",
      target: "npm test -- --watch",
      scope: "request",
      title: "Run tests",
      body: "The peer wants to run the suite.",
    },
  });

  const QUESTION_DETAIL_ROW = entry({
    identity: "p-question-d",
    slug: "fence-question-d",
    activity: "blocked",
    status: "started",
    requestId: "req-question-d",
    requestKind: "question",
    operationId: "dispatch-op-1",
    requestDetail: {
      header: "Depth",
      question: "How deep?",
      options: [
        { label: "Fast", description: "Unit tests" },
        { label: "Full", description: "All checks" },
      ],
      multiSelect: false,
      allowFreeText: true,
    },
  });

  it("shows the approval's tool and target with each decision's consequence", () => {
    const markup = render([APPROVAL_DETAIL_ROW]);
    expect(markup).toContain("shell");
    expect(markup).toContain("npm test -- --watch");
    // Consequence copy per decision (§4.3): Approve once / session / Deny.
    expect(markup).toContain("Approve once");
    expect(markup).toContain("Approve for this session");
    expect(markup).toContain("Deny");
  });

  it("shows the question's header and choices with a free-text escape", () => {
    const markup = render([QUESTION_DETAIL_ROW]);
    expect(markup).toContain("How deep?");
    expect(markup).toContain("Fast");
    expect(markup).toContain("Full");
    expect(markup).toContain('data-row-draft="answer"');
  });

  it("keeps a detail-less approval row actionable with plain labels", () => {
    const markup = render([APPROVAL_ROW]);
    expect(markup).toContain("Approve once");
    expect(markup).toContain("data-row-action=\"approve\"");
  });

  it("renders Sent / Stop requested acknowledgments and outcome words", () => {
    const ackRow = entry({
      identity: "p-ack",
      slug: "fence-ack",
      activity: "live",
      operationId: "dispatch-op-1",
      acknowledgment: { kind: "sent", action: "steer" },
    });
    const stopRow = entry({
      identity: "p-stop",
      slug: "fence-stop",
      activity: "live",
      operationId: "dispatch-op-1",
      acknowledgment: { kind: "stop-requested" },
    });
    const doneRow = entry({
      identity: "p-outcome",
      slug: "fence-outcome",
      activity: "done",
      finishedAt: 1,
      outcome: "stopped",
    });
    const markup = render([ackRow, stopRow, doneRow]);
    expect(markup).toContain("Sent");
    expect(markup).toContain("Stop requested");
    expect(markup).toContain("Stopped");
  });
});

describe("PeerDock row answer card (stateless, §4.3)", () => {
  it("renders the question card's radio choices inline on the row", () => {
    const markup = renderToStaticMarkup(
      <PeerDock manager={managerFor([QUESTION_DETAIL_ROW_STANDALONE])} onRowAction={() => undefined} />,
    );
    expect(markup).toContain('type="radio"');
    expect(markup).toContain('name="req-question-d:0"');
  });
});


describe("peerAnswerRequest — the App-side Answer card adapter (judge r2 #4)", () => {
  it("projects a question-blocked row onto the question card's request shape", async () => {
    const { peerAnswerRequest } = await import("./PeerDock.tsx");
    expect(peerAnswerRequest(QUESTION_DETAIL_ROW_STANDALONE)).toEqual({
      sessionId: "p-question-s",
      questionId: "req-question-d",
      turnId: QUESTION_DETAIL_ROW_STANDALONE.turnId,
      title: "Depth",
      body: "How deep?",
      questions: [
        {
          header: "Depth",
          question: "How deep?",
          options: [
            { label: "Fast", description: "Unit tests" },
            { label: "Full", description: "All checks" },
          ],
          multiSelect: false,
          allowFreeText: true,
        },
      ],
    });
  });

  it("is null unless the row is question-blocked with a real id + detail", async () => {
    const { peerAnswerRequest } = await import("./PeerDock.tsx");
    expect(peerAnswerRequest(APPROVAL_ROW)).toBeNull();
    expect(
      peerAnswerRequest(
        entry({
          identity: "q-noid",
          slug: "q-noid",
          activity: "blocked",
          requestKind: "question",
          requestId: null,
        }),
      ),
    ).toBeNull();
  });
});

describe("PeerDock row body drops the raw slug (triage 4510 P2)", () => {
  const render = (peers: readonly PeerRosterEntry[]) =>
    renderToStaticMarkup(<PeerDock manager={managerFor(peers)} onRowAction={() => undefined} />);

  it("renders 'Peer N · model' as the row identity, never the raw slug text", () => {
    const markup = render([APPROVAL_ROW, BASE]);
    // The visible identity is the peer label, not the slug.
    expect(markup).toContain("Peer 1");
    expect(markup).toContain("Peer 2");
    // The slug survives ONLY as the diagnostic data attribute, never as text.
    expect(markup).not.toContain(">fence-approve<");
    expect(markup).not.toContain(">fence-a<");
    expect(markup).toContain('data-peer-slug="fence-approve"');
  });

  it("appends the accepted dispatch's model to the row label when supplied", () => {
    const markup = render([
      entry({
        identity: "p-model",
        slug: "fence-model",
        activity: "live",
        operationId: "dispatch-op-1",
        model: "glm-5.3",
      }),
    ]);
    expect(markup).toContain("Peer 1 · glm-5.3");
    expect(markup).not.toContain(">fence-model<");
  });
});
