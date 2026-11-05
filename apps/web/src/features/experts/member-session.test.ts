import { describe, expect, it, vi } from "vitest";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import { readMemberTurns, stopMemberTurn } from "./member-session.ts";

const client = (interrupt: () => Promise<unknown>) => ({
  hydrateSession: vi.fn().mockResolvedValue({
    turns: [{ turn_id: "t1", state: "active" }],
  }),
  interruptTurn: vi.fn(interrupt),
});

describe("member sessions", () => {
  it("asks hydrate for turns only", async () => {
    const member = client(async () => ({}));
    await expect(readMemberTurns(member, "s1")).resolves.toEqual([
      { turn_id: "t1", state: "active" },
    ]);
    expect(member.hydrateSession).toHaveBeenCalledWith({
      session_id: "s1",
      include: ["turns"],
    });
  });

  it("stops exactly the named turn and reads a refusal as a no", async () => {
    const stopped = client(async () => ({ interrupted: true }));
    await expect(stopMemberTurn(stopped, "s1", "t1")).resolves.toBe("stopped");
    expect(stopped.interruptTurn).toHaveBeenCalledWith("s1", "t1");
    await expect(
      stopMemberTurn(
        client(async () => ({
          interrupted: false,
          reason: "turn_id_mismatch",
        })),
        "s1",
        "t1",
      ),
    ).resolves.toBe("declined");
    await expect(
      stopMemberTurn(
        client(async () => {
          throw new OctosUiProtocolError(-32101, "unknown turn: t1");
        }),
        "s1",
        "t1",
      ),
    ).resolves.toBe("declined");
    await expect(
      stopMemberTurn(
        client(async () => {
          throw new Error("socket closed");
        }),
        "s1",
        "t1",
      ),
    ).resolves.toBe("failed");
  });
});
