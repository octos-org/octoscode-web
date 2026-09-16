import { describe, expect, it } from "vitest";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import { turnCollisionFrom } from "./turn-collision.ts";

const OTHER_TURN = "3f1a9c52-4d1b-4c2e-8f6a-0b7d21e9c4aa";

describe("turnCollisionFrom", () => {
  it("names the occupying turn when the server sends the typed data", () => {
    const collision = turnCollisionFrom(
      new OctosUiProtocolError(
        -32600,
        "a turn is already running for this session",
        { kind: "turn_in_progress", turn_id: OTHER_TURN },
      ),
    );
    expect(collision).toEqual({ turnId: OTHER_TURN });
  });

  it("still recognises the refusal from an older server's prose alone", () => {
    // Servers predating the typed kind send only the sentence. The session is
    // busy either way; we simply cannot adopt the other client's turn.
    const collision = turnCollisionFrom(
      new OctosUiProtocolError(
        -32600,
        "turn/start: a turn is already running for this session",
      ),
    );
    expect(collision).toEqual({});
  });

  it("takes the typed kind even when the message was reworded", () => {
    const collision = turnCollisionFrom(
      new OctosUiProtocolError(-32600, "session occupied", {
        kind: "turn_in_progress",
        turn_id: OTHER_TURN,
      }),
    );
    expect(collision).toEqual({ turnId: OTHER_TURN });
  });

  it("refuses a turn id that is not a protocol uuid rather than adopting it", () => {
    // Adopting a bogus id would wedge the queue on a turn that can never
    // settle, so the busy signal survives and the id does not.
    const collision = turnCollisionFrom(
      new OctosUiProtocolError(
        -32600,
        "a turn is already running for this session",
        {
          kind: "turn_in_progress",
          turn_id: "not-a-uuid",
        },
      ),
    );
    expect(collision).toEqual({});
  });

  it("is null for every other failure", () => {
    expect(
      turnCollisionFrom(
        new OctosUiProtocolError(-32602, "cwd is not accessible"),
      ),
    ).toBeNull();
    expect(
      turnCollisionFrom(
        new OctosUiProtocolError(-32600, "denied", {
          kind: "driver_mode_forbidden",
        }),
      ),
    ).toBeNull();
    // A transport timeout is not proof of anything and must keep the existing
    // "unconfirmed" path, which does not discard the turn.
    expect(
      turnCollisionFrom(
        new Error("a turn is already running for this session"),
      ),
    ).toBeNull();
    expect(turnCollisionFrom(null)).toBeNull();
    expect(turnCollisionFrom("busy")).toBeNull();
  });
});
