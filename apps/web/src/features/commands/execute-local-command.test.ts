import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineEntry } from "../timeline/model.ts";
import {
  executeLocalCommand,
  type ExecuteLocalCommandInput,
  type LocalCommandIntent,
} from "./execute-local-command.ts";

afterEach(() => vi.unstubAllGlobals());

describe("local command scope", () => {
  it.each(["resolve", "reject"] as const)(
    "does not write clipboard %s feedback into a replacement Session",
    async (outcome) => {
      const clipboard = deferred();
      const writeText = vi.fn(() => clipboard.promise);
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      const harness = context({ kind: "copy" });
      const pending = executeLocalCommand(harness.input);
      expect(writeText).toHaveBeenCalledWith("Original assistant reply");
      expect(harness.updates).toHaveLength(0);

      harness.retire();
      if (outcome === "resolve") clipboard.resolve();
      else clipboard.reject(new Error("Clipboard denied"));
      await pending;

      expect(harness.updates).toHaveLength(0);
    },
  );

  it("does not start a delayed command after its original Session was replaced", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const harness = context({ kind: "copy" });
    harness.retire();

    await executeLocalCommand(harness.input);

    expect(writeText).not.toHaveBeenCalled();
    expect(harness.updates).toHaveLength(0);
  });

  it("rechecks identity when React applies a previously queued timeline update", async () => {
    const harness = context({ kind: "status" });
    await executeLocalCommand(harness.input);
    expect(harness.updates).toHaveLength(1);
    harness.retire();
    const replacement: TimelineEntry[] = [
      {
        id: "another-session",
        kind: "user",
        title: "You",
        body: "New Session",
        status: "complete",
      },
    ];

    expect(harness.apply(replacement)).toBe(replacement);
  });
});

describe("copy feedback", () => {
  it("reports success only after copying the last nonempty assistant reply", async () => {
    const clipboard = deferred();
    const writeText = vi.fn(() => clipboard.promise);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const harness = context({ kind: "copy" });
    harness.input.conversation.timeline.push(
      {
        id: "empty",
        kind: "assistant",
        title: "Octos",
        body: "",
        status: "running",
      },
      {
        id: "tool",
        kind: "tool",
        title: "Tool",
        body: "Do not copy tool output",
        status: "complete",
      },
    );
    const pending = executeLocalCommand(harness.input);
    expect(harness.updates).toHaveLength(0);
    expect(writeText).toHaveBeenCalledWith("Original assistant reply");
    clipboard.resolve();
    await pending;

    expect(harness.apply([])).toMatchObject([
      {
        title: "Copied",
        status: "complete",
        body: "The last assistant reply is on the clipboard.",
      },
    ]);
  });

  it.each(["missing", "throws", "rejects"] as const)(
    "handles a clipboard API that %s without escaping as an unhandled command failure",
    async (mode) => {
      const message =
        mode === "missing"
          ? "Clipboard access is unavailable in this browser."
          : "Clipboard denied";
      vi.stubGlobal(
        "navigator",
        mode === "missing"
          ? {}
          : {
              clipboard: {
                writeText:
                  mode === "throws"
                    ? () => {
                        throw new Error(message);
                      }
                    : async () => {
                        throw new Error(message);
                      },
              },
            },
      );
      const harness = context({ kind: "copy" });

      await expect(executeLocalCommand(harness.input)).resolves.toBeUndefined();

      expect(harness.apply([])).toMatchObject([
        {
          title: "Copy failed",
          body: message,
          status: "error",
        },
      ]);
    },
  );

  it("does not access clipboard when no assistant reply exists", async () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const harness = context({ kind: "copy" });
    harness.input.conversation.timeline = [];

    await executeLocalCommand(harness.input);

    expect(writeText).not.toHaveBeenCalled();
    expect(harness.apply([])).toMatchObject([{ title: "Nothing to copy" }]);
  });
});

function context(intent: LocalCommandIntent) {
  let current = true;
  const updates: Parameters<
    ExecuteLocalCommandInput["conversation"]["setTimeline"]
  >[0][] = [];
  const input: ExecuteLocalCommandInput = {
    intent,
    opened: { session_id: "original" },
    conversation: {
      timeline: [
        {
          id: "assistant",
          kind: "assistant",
          title: "Octos",
          body: "Original assistant reply",
          status: "complete",
        },
      ],
      queue: { active: null, pending: [] },
      setTimeline: (update) => {
        updates.push(update);
      },
    },
    models: { state: { models: [] } },
    safety: { permission: { result: null } },
    work: { supervision: { runtimeStatus: null } },
    isCurrent: () => current,
  };
  return {
    input,
    updates,
    retire: () => {
      current = false;
    },
    apply: (entries: TimelineEntry[]) =>
      updates.reduce<TimelineEntry[]>(
        (previous, update) =>
          typeof update === "function" ? update(previous) : update,
        entries,
      ),
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
