import { describe, expect, it } from "vitest";
import type { McpConnectorMutation } from "@octos-org/octoscode-client/inventory";
import {
  afterMutation,
  readSavedConnectors,
  withoutListed,
  writeSavedConnectors,
  type SavedConnector,
} from "./saved-connectors.ts";

const connector = {
  id: "mcp-1",
  name: "Docs",
  transport: "http",
  enabled: true,
  url: "https://docs.invalid/mcp",
};
const pinned = { restartRequired: true, effectiveFrom: "next_turn" };
const mutation = (
  fields: Partial<McpConnectorMutation>,
): McpConnectorMutation => ({
  created: false,
  deleted: false,
  listed: false,
  ...fields,
});
const row: SavedConnector = { ...connector, takesEffect: "restart" };

describe("saved connectors", () => {
  it("adds what the server saved and did not list", () => {
    expect(
      afterMutation(
        [],
        mutation({ connector, runtime: pinned, created: true }),
      ),
    ).toEqual([row]);
  });

  it("believes a restart requirement over the next-turn promise sent with it", () => {
    const [saved] = afterMutation(
      [],
      mutation({ connector, runtime: pinned, created: true }),
    );
    expect(saved?.takesEffect).toBe("restart");
  });

  it("promises the next turn only when no restart is required", () => {
    const [saved] = afterMutation(
      [],
      mutation({
        connector,
        runtime: { restartRequired: false, effectiveFrom: "next_turn" },
        created: true,
      }),
    );
    expect(saved?.takesEffect).toBe("next_turn");
  });

  it("promises nothing when the server gave no timing", () => {
    const [saved] = afterMutation([], mutation({ connector, created: true }));
    expect(saved?.takesEffect).toBe("unknown");
  });

  it("keeps why the server could not load it", () => {
    const [saved] = afterMutation(
      [],
      mutation({
        connector,
        runtime: {
          restartRequired: false,
          effectiveFrom: "next_turn",
          error: "rebuild failed",
        },
        created: true,
      }),
    );
    expect(saved?.error).toBe("rebuild failed");
  });

  it("adds nothing for a connector the server already lists", () => {
    expect(
      afterMutation(
        [],
        mutation({ connector, runtime: pinned, created: true, listed: true }),
      ),
    ).toEqual([]);
  });

  it("adds nothing without a connector, or for one it did not just create", () => {
    expect(afterMutation([], mutation({ created: true }))).toEqual([]);
    expect(afterMutation([], mutation({ connector, runtime: pinned }))).toEqual(
      [],
    );
  });

  it("updates a row in place and does not duplicate it", () => {
    expect(
      afterMutation(
        [row],
        mutation({
          connector: { ...connector, name: "Renamed", enabled: false },
          runtime: pinned,
        }),
      ),
    ).toEqual([{ ...row, name: "Renamed", enabled: false }]);
  });

  it("removes a deleted row by the id that was asked for", () => {
    const other = { ...row, id: "mcp-2" };
    expect(
      afterMutation(
        [row, other],
        mutation({ deleted: true, runtime: pinned }),
        "mcp-1",
      ),
    ).toEqual([other]);
  });

  it("hands over to the server's row once it lists the connector", () => {
    const other = { ...row, id: "mcp-2" };
    const server = {
      id: "mcp-1",
      status: "failed",
      enabled: true,
      toolCount: 0,
      tools: [],
    };
    expect(withoutListed([row, other], [server])).toEqual([other]);
    const saved = [row];
    expect(withoutListed(saved, [])).toBe(saved);
  });

  it("keeps rows apart per connection and per profile", () => {
    const first = {};
    const second = {};
    writeSavedConnectors(first, "coding", [row]);
    expect(readSavedConnectors(first, "coding")).toEqual([row]);
    expect(readSavedConnectors(first, "other")).toEqual([]);
    expect(readSavedConnectors(second, "coding")).toEqual([]);
  });
});
