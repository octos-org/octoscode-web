import { describe, expect, it } from "vitest";
import { OctosUiProtocolError } from "@octos-org/octoscode-client/protocol";
import { turnCollisionFrom } from "./turn-collision.ts";

// A refused turn/start is read as "another client is running a turn" ONLY from
// Core's typed `turn_in_progress` data with a protocol UUID. That reading
// restores the whole draft and adopts the occupier's turn (see the controller
// suite's "another attached client" cases); guessing it from prose, or from a
// transport error that proves nothing, would discard or reroute a prompt.
const OTHER_TURN = "3f1a9c52-4d1b-4c2e-8f6a-0b7d21e9c4aa";

describe("turnCollisionFrom", () => {
  it.each([
    [
      "typed data names the occupier",
      new OctosUiProtocolError(
        -32600,
        "a turn is already running for this session",
        { kind: "turn_in_progress", turn_id: OTHER_TURN },
      ),
      { turnId: OTHER_TURN },
    ],
    [
      "typed data wins over a reworded message",
      new OctosUiProtocolError(-32600, "session occupied", {
        kind: "turn_in_progress",
        turn_id: OTHER_TURN,
      }),
      { turnId: OTHER_TURN },
    ],
    [
      "prose without the typed contract",
      new OctosUiProtocolError(
        -32600,
        "turn/start: a turn is already running for this session",
      ),
      null,
    ],
    [
      "a turn id that is not a protocol UUID",
      new OctosUiProtocolError(
        -32600,
        "a turn is already running for this session",
        { kind: "turn_in_progress", turn_id: "not-a-uuid" },
      ),
      null,
    ],
    [
      "another typed kind",
      new OctosUiProtocolError(-32600, "denied", {
        kind: "driver_mode_forbidden",
      }),
      null,
    ],
    [
      "another error code",
      new OctosUiProtocolError(-32602, "cwd is not accessible"),
      null,
    ],
    // A transport failure keeps the "unconfirmed" path, which keeps the turn.
    [
      "a transport error with the same words",
      new Error("a turn is already running for this session"),
      null,
    ],
    ["no error", null, null],
    ["a bare string", "busy", null],
  ] as const)("%s", (_name, error, collision) => {
    expect(turnCollisionFrom(error)).toEqual(collision);
  });
});
