/**
 * peer-manager round 2 (judge #4, WEB-UX-ROUND2-4400) — RED-first.
 *
 * Design §4.3 acknowledgment vs outcome semantics, ported to the manager's
 * activity axis so both Fleet and the dock render from ONE source:
 *  - a control ack is an ACKNOWLEDGMENT ("Sent" / "Stop requested"), never a
 *    terminal outcome;
 *  - a turn terminal carries its OUTCOME (finished / stopped / failed); the
 *    interrupted code maps to "stopped" — Finished / Stopped / Failed are
 *    terminals, Sent is not;
 *  - a replacement turn (turn id change) invalidates a held action intent so
 *    the row demands a fresh click instead of silently retargeting.
 *
 * Seeded through the SAME public seams as peer-manager.test.ts (staged
 * notification + background open), so nothing private is reached.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createPeerCommands,
  PEER_METHODS,
  type PeerCommands,
} from "@octos-org/octoscode-client/peers";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import { PeerManager } from "./peer-manager.ts";
import type { PeerOpenRequest, PeerOpenOutcome } from "./peer-manager.ts";

const caps: UiProtocolCapabilities = {
  version: { protocol: "octos-ui/v1alpha1", schema_version: 1, jsonrpc: "2.0" },
  capabilities_schema_version: 2,
  supported_methods: [PEER_METHODS.PREPARE, PEER_METHODS.GATHER],
  supported_notifications: [PEER_METHODS.STAGED, PEER_METHODS.CLOSED],
  supported_features: [],
};
const peer = {
  slug: "review",
  topic: "peer-review",
  profile_id: "dev",
  cwd: "/repo/wt",
  brief_path: "/peers/review/brief.md",
};
const staged = {
  method: PEER_METHODS.STAGED,
  params: { ...peer, session_id: "dev:local:tui", brief: "Review this" },
};
const identity = "dev:local:tui#peer-review";
const UUID_B = "22222222-2222-2222-2222-222222222222";

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

async function setup(
  open: (request: PeerOpenRequest) => Promise<PeerOpenOutcome> = async () => ({
    status: "started",
  }),
) {
  const request = vi
    .fn<(method: string, params: unknown) => Promise<unknown>>()
    .mockResolvedValue({ ...peer, peers: [peer] });
  let authority = {};
  const create = () =>
    createPeerCommands(
      { request },
      { sessionId: "dev:local:tui", profileId: "dev", authority },
      caps,
    );
  let commands: PeerCommands | null = create();
  const manager = new PeerManager({
    commands: () => commands,
    onOpenPeer: vi.fn(open),
    onClosePeer: vi.fn(),
    readOnly: () => false,
  });
  manager.observeNotification(staged, commands);
  await flush();
  return {
    manager,
    get commands() {
      if (!commands) throw new Error("commands withdrawn");
      return commands;
    },
  };
}

/** The seeded row, or null — one helper so each case reads on one line. */
function row(h: { manager: PeerManager }) {
  return h.manager
    .getSnapshot()
    .peers.find((candidate) => candidate.identity === identity);
}

/** The row's REAL kickoff turn id (the staging seam mints it per test). */
function realTurnId(h: { manager: PeerManager }): string {
  const turnId = row(h)?.turnId;
  if (!turnId) throw new Error("row not staged");
  return turnId;
}

/** Stage + start one turn so the row is LIVE before each ack case. */
async function setupLive() {
  const h = await setup();
  h.manager.observeSessionEvent(
    { sessionId: identity, kind: "turn-started", turnId: realTurnId(h) },
    h.commands,
  );
  expect(row(h)?.activity).toBe("live");
  return h;
}

describe("peer acknowledgment vs terminal outcome axis (judge #4)", () => {
  it("a control ack stamps 'sent' without ending the activity", async () => {
    const h = await setupLive();
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "control-ack", action: "steer" },
        h.commands,
      ),
    ).toBe(true);
    expect(row(h)).toMatchObject({
      activity: "live",
      acknowledgment: { kind: "sent", action: "steer" },
    });
  });

  it("a Stop ack stamps 'Stop requested' — never 'Stopped'", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "control-ack", action: "interrupt" },
      h.commands,
    );
    expect(row(h)).toMatchObject({
      activity: "live",
      acknowledgment: { kind: "stop-requested" },
    });
  });

  it("turn terminal carries outcome; the interrupted code maps to stopped", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal", outcome: "finished" },
      h.commands,
    );
    expect(row(h)).toMatchObject({ activity: "done", outcome: "finished" });

    const second = await setupLive();
    second.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal", outcome: "interrupted" },
      second.commands,
    );
    expect(row(second)).toMatchObject({
      activity: "done",
      outcome: "stopped",
    });
  });

  it("an error terminal maps to failed and keeps the error text", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "turn-terminal",
        outcome: "failed",
        error: "boom",
      },
      h.commands,
    );
    expect(row(h)).toMatchObject({ activity: "done", outcome: "failed" });
  });

  it("a terminal clears any pending acknowledgment", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "control-ack", action: "interrupt" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-terminal", outcome: "interrupted" },
      h.commands,
    );
    expect(row(h)).toMatchObject({
      acknowledgment: null,
      outcome: "stopped",
    });
  });

  it("a replacement turn drops a pending acknowledgment and records the new turn", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "control-ack", action: "steer" },
      h.commands,
    );
    expect(
      h.manager.observeSessionEvent(
        { sessionId: identity, kind: "turn-started", turnId: UUID_B },
        h.commands,
      ),
    ).toBe(true);
    expect(row(h)).toMatchObject({
      turnId: UUID_B,
      acknowledgment: null,
      // Renewed-intent marker: the row must tell the operator the peer moved on.
      turnChangedSinceAck: true,
    });
  });

  it("a same-turn turn-started keeps an existing acknowledgment", async () => {
    const h = await setupLive();
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "control-ack", action: "steer" },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "turn-started", turnId: realTurnId(h) },
      h.commands,
    );
    expect(row(h)).toMatchObject({
      acknowledgment: { kind: "sent", action: "steer" },
    });
    expect(row(h)?.turnChangedSinceAck).toBeFalsy();
  });
});

describe("attention-requested carries the request's CONTENTS (judge r2 #4)", () => {
  it("stamps an approval's tool, target and the request's scope", async () => {
    const h = await setup();
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestKind: "approval",
        requestId: "appr-7",
        approval: {
          toolName: "shell",
          target: "npm test -- --watch",
          scope: "request",
          title: null,
          body: null,
        },
      },
      h.commands,
    );
    expect(row(h)).toMatchObject({
      activity: "blocked",
      requestId: "appr-7",
      requestKind: "approval",
      requestDetail: {
        toolName: "shell",
        target: "npm test -- --watch",
        scope: "request",
      },
    });
  });

  it("stamps a question's header/choices so the row can open the card", async () => {
    const h = await setup();
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestKind: "question",
        requestId: "q-9",
        question: {
          header: "Depth",
          question: "How deep?",
          options: [
            { label: "Fast", description: "Unit tests" },
            { label: "Full", description: "All checks" },
          ],
          multiSelect: false,
          allowFreeText: true,
        },
      },
      h.commands,
    );
    expect(row(h)).toMatchObject({
      requestDetail: {
        header: "Depth",
        options: [{ label: "Fast" }, { label: "Full" }],
      },
    });
  });

  it("clears the contents when the request resolves", async () => {
    const h = await setup();
    h.manager.observeSessionEvent(
      {
        sessionId: identity,
        kind: "attention-requested",
        requestKind: "approval",
        requestId: "appr-7",
        approval: {
          toolName: "shell",
          target: "rm -rf /",
          scope: "request",
          title: null,
          body: null,
        },
      },
      h.commands,
    );
    h.manager.observeSessionEvent(
      { sessionId: identity, kind: "attention-resolved" },
      h.commands,
    );
    expect(row(h)?.requestDetail).toBeNull();
  });
});
