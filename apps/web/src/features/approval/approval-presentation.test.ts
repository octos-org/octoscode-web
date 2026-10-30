import { describe, expect, it } from "vitest";
import type { ApprovalRequested } from "@octos-org/octoscode-client/protocol";
import {
  approvalImpactDetails,
  permissionDeniedReason,
} from "./approval-presentation.ts";

const approval: ApprovalRequested = {
  sessionId: "session-1",
  approvalId: "approval-1",
  turnId: "turn-1",
  toolName: "shell",
  title: "Delete the build directory?",
  body: "The agent wants to remove old output.",
  risk: "high",
  typedDetails: {
    command: {
      command_line: "rm -rf dist",
      cwd: "/workspace/app",
      network: false,
    },
  },
};

describe("approval presentation", () => {
  it("describes directory, network, and deletion without guessing", () => {
    expect(approvalImpactDetails(approval)).toEqual({
      directory: "/workspace/app",
      network: "blocked",
      destructive: true,
    });
    expect(
      approvalImpactDetails({
        ...approval,
        typedDetails: { command: { command_line: "pnpm check" } },
      }),
    ).toEqual({ network: "unspecified", destructive: false });
  });

  it("offers retry only for permission failures", () => {
    expect(
      permissionDeniedReason(
        "error",
        "write_file is not permitted by read-only filesystem access",
      ),
    ).toBe(true);
    expect(permissionDeniedReason("error", "file already exists")).toBe(false);
    expect(permissionDeniedReason("complete", "permission denied")).toBe(false);
  });
});
