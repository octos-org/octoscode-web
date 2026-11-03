import { describe, expect, it } from "vitest";
import { commandReceipt, summarizeTurn } from "./turn-summary.ts";
import type { TimelineEntry } from "./entry-model.ts";

const tool = (
  title: string,
  path: string,
  status: TimelineEntry["status"],
  startedAtMs: number,
): TimelineEntry => ({
  id: `tool:${title}:${startedAtMs}`,
  kind: "tool",
  title,
  body: status === "error" ? "permission denied" : "ok",
  toolArguments: JSON.stringify({ path }),
  status,
  turnId: "turn-1",
  startedAtMs,
  endedAtMs: startedAtMs + 1000,
});

describe("turn summary", () => {
  it("reports duration, changed/output files, failures, and token usage", () => {
    const entries: TimelineEntry[] = [
      tool("write_file", "report.md", "complete", 1000),
      tool("edit_file", "report.md", "complete", 2000),
      tool("write_file", "notes.md", "error", 3000),
      {
        id: "terminal:turn-1",
        kind: "system",
        title: "Turn complete",
        body: "",
        status: "complete",
        turnId: "turn-1",
        startedAtMs: 1000,
        endedAtMs: 5000,
        turnUsage: { input: 12, output: 9 },
      },
    ];
    expect(summarizeTurn(entries, "turn-1")).toEqual({
      seconds: 4,
      unlistedChanges: 0,
      commandChangesUnknown: false,
      changedFiles: ["report.md"],
      outputFiles: ["report.md"],
      failedSteps: 1,
      retriedSteps: 0,
      usage: { input: 12, output: 9 },
    });
  });

  describe("what commands changed", () => {
    const command = (body: string, startedAtMs = 1000): TimelineEntry => ({
      ...tool("exec_command", "", "complete", startedAtMs),
      body,
      toolArguments: JSON.stringify({ cmd: "x" }),
    });
    const inGit = (receipt: string) =>
      `(no output)\n\nExit code: 0\n${receipt}\nscope: workdir`;

    it("counts what Core measured, and trusts its zero", () => {
      const summary = summarizeTurn(
        [
          command(inGit("files_changed: 1\n  a.txt")),
          command(inGit("files_changed: 0"), 2000),
        ],
        "turn-1",
      );
      expect(summary.changedFiles).toEqual(["a.txt"]);
      expect(summary.commandChangesUnknown).toBe(false);
    });

    it("says it does not know when a command left no measurement", () => {
      expect(
        summarizeTurn([command("(no output)\n\nExit code: 0")], "turn-1"),
      ).toMatchObject({ changedFiles: [], commandChangesUnknown: true });
      // A long output's preview is cut before the receipt.
      expect(
        summarizeTurn([command("1\n2\n3\n4...")], "turn-1")
          .commandChangesUnknown,
      ).toBe(true);
    });

    it("keeps what file tools recorded beside an unmeasured command", () => {
      expect(
        summarizeTurn(
          [
            tool("write_file", "a.txt", "complete", 1000),
            command("(no output)\n\nExit code: 0", 2000),
          ],
          "turn-1",
        ),
      ).toMatchObject({
        changedFiles: ["a.txt"],
        commandChangesUnknown: true,
      });
    });

    it("does not count a file twice when a command touches it after a file tool", () => {
      expect(
        summarizeTurn(
          [
            tool("write_file", "a.txt", "complete", 1000),
            command(inGit("files_changed: 1\n  a.txt"), 2000),
          ],
          "turn-1",
        ).changedFiles,
      ).toEqual(["a.txt"]);
    });

    it("ignores a command that never ran", () => {
      expect(
        summarizeTurn(
          [
            {
              ...command("Command denied by user approval: rm -rf /tmp/x"),
              status: "error",
            },
          ],
          "turn-1",
        ).commandChangesUnknown,
      ).toBe(false);
    });

    it("leaves other tools out of it", () => {
      expect(
        summarizeTurn([tool("read_file", "a.txt", "complete", 1000)], "turn-1")
          .commandChangesUnknown,
      ).toBe(false);
    });
  });

  describe("commandReceipt", () => {
    it("reads the count and the paths", () => {
      expect(
        commandReceipt(
          "ok\n\nExit code: 0\nfiles_changed: 2\n  a.txt\n  src/b.txt\nscope: workdir",
        ),
      ).toEqual({ count: 2, paths: ["a.txt", "src/b.txt"] });
    });

    it("keeps unlisted files in the count", () => {
      expect(
        commandReceipt("files_changed: 25\n  a.txt\n  (+24 more; not listed)"),
      ).toEqual({ count: 25, paths: ["a.txt"] });
      expect(commandReceipt("files_changed: 2\n  a.txt\n  src/b.t...")).toEqual(
        { count: 2, paths: ["a.txt"] },
      );
    });

    it("takes the last one, because a command can print anything first", () => {
      expect(
        commandReceipt("files_changed: 9\n  fake\nmore\nfiles_changed: 0"),
      ).toEqual({ count: 0, paths: [] });
    });

    it("finds nothing without one", () => {
      expect(commandReceipt("Exit code: 0")).toBeNull();
      expect(commandReceipt("no files_changed: 3 here")).toBeNull();
    });
  });

  it("never lists what the user attached as an output", () => {
    const summary = summarizeTurn(
      [
        {
          id: "user:turn-1",
          kind: "user",
          title: "You",
          body: "Clean it",
          status: "complete",
          turnId: "turn-1",
          media: ["uploads/sales.csv"],
        },
        tool("write_file", "sales-clean.csv", "complete", 1000),
      ],
      "turn-1",
    );
    expect(summary.outputFiles).toEqual(["sales-clean.csv"]);
  });

  it("counts a failure a later call of the same tool succeeded at as retried", () => {
    const summary = summarizeTurn(
      [
        tool("write_file", "notes.md", "error", 1000),
        tool("exec_command", "ls", "error", 2000),
        tool("write_file", "notes.md", "complete", 3000),
      ],
      "turn-1",
    );
    expect(summary.retriedSteps).toBe(1);
    expect(summary.failedSteps).toBe(1);
  });

  it("counts distinct long paths before truncating display targets", () => {
    const first = "src/components/shared/very-long-directory/first.ts";
    const second = "src/components/shared/very-long-directory/second.ts";
    const summary = summarizeTurn(
      [
        tool("write_file", first, "complete", 1000),
        tool("write_file", second, "complete", 2000),
      ],
      "turn-1",
    );
    expect(summary.changedFiles).toEqual([first, second]);
    expect(summary.outputFiles).toEqual([first, second]);
  });
});
