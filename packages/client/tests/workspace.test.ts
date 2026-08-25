import { describe, expect, it } from "vitest";
import {
  parseSessionDeleteResult,
  parseSessionFilesListResult,
  parseSessionListResult,
  parseSessionStatusReadResult,
  parseTokenCostUpdate,
} from "../src/index.ts";
import type { RpcNotification } from "../src/index.ts";
import fixture from "./fixtures/ui-protocol-v1.json";

describe("workspace product contract", () => {
  it("decodes session rows and file handles without exposing host paths", () => {
    expect(parseSessionListResult(fixture.session_list.result)).toMatchObject({
      sessions: [{ message_count: 12 }],
    });
    expect(
      parseSessionFilesListResult(fixture.session_files_list.result),
    ).toMatchObject({ files: [{ filename: "check.txt", size_bytes: 42 }] });
    expect(parseSessionDeleteResult(fixture.session_delete.result)).toEqual({});
  });

  it("rejects malformed session metadata and file sizes", () => {
    expect(
      parseSessionListResult({ sessions: [{ id: "", message_count: -1 }] }),
    ).toBeNull();
    expect(
      parseSessionFilesListResult({
        files: [
          { filename: "x", path: "x", size_bytes: -1, modified_at: "now" },
        ],
      }),
    ).toBeNull();
  });

  it("decodes status cost totals and live context-window updates", () => {
    expect(
      parseSessionStatusReadResult(fixture.session_status_read.result),
    ).toMatchObject({
      usage: { input_tokens: 1200, estimated_cost_micros_usd: 2500 },
      health: { status: "ok" },
    });
    expect(
      parseTokenCostUpdate(
        fixture.token_cost_update as unknown as RpcNotification,
      ),
    ).toMatchObject({
      sessionId: "coding:local:main",
      inputTokens: 128_000,
      sessionCost: 0.12,
      contextWindow: 1_000_000,
    });
  });
});
