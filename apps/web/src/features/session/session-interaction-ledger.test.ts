import { describe, expect, it } from "vitest";
import {
  SessionInteractionLedger,
  StaleInteractionGenerationError,
  type SessionInteractionClient,
} from "./session-interaction-ledger.ts";

const endpoint = "ws://server.test/ui";
const cfg = { endpoint, sessionId: "s1" };

interface Call {
  method: string;
  params: Record<string, unknown>;
}

function fakeClient() {
  const calls: Call[] = [];
  const client: SessionInteractionClient = {
    respondApproval: async (params) => {
      calls.push({ method: "approval/respond", params: { ...params } });
      return { approval_id: params.approval_id, accepted: true };
    },
    respondUserQuestion: async (params) => {
      calls.push({ method: "user_question/respond", params: { ...params } });
      return { question_id: params.question_id, accepted: true };
    },
  };
  return { client, calls };
}

describe("SessionInteractionLedger", () => {
  it("resolve fails closed when the Session reconnected since observation", async () => {
    const { client, calls } = fakeClient();
    let generation = 5;
    const ledger = new SessionInteractionLedger({
      authorityFor: () => ({ generation, client, sessionId: "s1" }),
    });
    ledger.observe(
      cfg,
      {
        kind: "approval",
        generation: 5,
        turnId: "t1",
        requestId: "ap-5",
        title: "Allow?",
      },
      { background: false },
    );
    const record = ledger.current(cfg)!;
    generation = 6; // socket replaced
    await expect(
      ledger.resolve(record, { decision: "approve" }),
    ).rejects.toBeInstanceOf(StaleInteractionGenerationError);
    expect(calls).toHaveLength(0); // never write into a stale socket
  });
});
