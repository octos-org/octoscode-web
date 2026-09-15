import { describe, expect, it } from "vitest";
import { createUiText } from "../preferences/ui-text.tsx";
import { localCommandReport } from "./local-report.ts";

describe("cold local command presentation", () => {
  const t = createUiText();
  it("keeps capability-filtered command names verbatim", () => {
    expect(
      localCommandReport(
        {
          kind: "help",
          commands: [
            { name: "theme", aliases: [] },
            { name: "lang", aliases: [] },
          ],
        },
        t,
      ),
    ).toEqual({
      title: "Commands",
      body: "/theme · /lang. Unsupported slash commands are never sent to the model.",
      error: false,
    });
  });
  it("reports captured queue status without a task owner or RPC", () => {
    expect(
      localCommandReport(
        { kind: "process-status", turn: "123456789abcdef", pending: 2 },
        t,
      ).body,
    ).toBe("Foreground turn 12345678 is active. 2 prompt(s) queued.");
    expect(
      localCommandReport({ kind: "process-status", turn: null, pending: 0 }, t)
        .body,
    ).toContain("No foreground turn");
  });
  it("translates labels without translating native model/path/permission values", () => {
    const text = createUiText("zh", {
      Workspace: "工作区",
      "Runtime model": "运行时模型",
      working: "运行中",
    });
    const report = localCommandReport(
      {
        kind: "status",
        workspace: "/srv/synthetic/work",
        runtimeModel: "anthropic/glm-5.3",
        profileDefault: undefined,
        permission: { mode: "read_only", network: "deny" },
        working: true,
      },
      text,
    );
    expect(report.body).toContain("工作区: /srv/synthetic/work");
    expect(report.body).toContain("运行时模型: anthropic/glm-5.3");
    expect(report.body).toContain("read_only · network deny");
    expect(report.error).toBe(false);
  });
  it("renders an unsupported command as an error without executable behavior", () => {
    expect(
      localCommandReport(
        { kind: "unsupported-command", command: "private-command" },
        t,
      ),
    ).toMatchObject({ title: "/private-command is unavailable", error: true });
    expect(
      localCommandReport(
        {
          kind: "unsupported-command",
          command: "lang",
          reason: "Use /lang [en | zh]. Nothing was sent to the model.",
        },
        t,
      ).body,
    ).toContain("Use /lang");
  });
  it("honestly explains the browser host boundary", () => {
    expect(
      localCommandReport({ kind: "local-shell-unavailable" }, t),
    ).toMatchObject({ title: "Local shell unavailable", error: true });
  });
  it("does not call a disconnected pending-only queue empty", () => {
    expect(
      localCommandReport({ kind: "process-status", turn: null, pending: 3 }, t)
        .body,
    ).toBe("No foreground turn is active. 3 prompt(s) remain queued.");
  });
  it("reports explicit preference-save and clipboard outcomes truthfully", () => {
    expect(
      localCommandReport({ kind: "save-config", saved: false }, t).error,
    ).toBe(true);
    expect(
      localCommandReport({ kind: "save-config", saved: true }, t).title,
    ).toBe("Browser preferences saved.");
    expect(
      localCommandReport({ kind: "copy", outcome: "empty" }, t).title,
    ).toBe("Nothing to copy");
    expect(
      localCommandReport({ kind: "copy", outcome: "copied" }, t).title,
    ).toBe("Copied");
    expect(
      localCommandReport(
        { kind: "copy", outcome: "failed", reason: "unavailable" },
        t,
      ),
    ).toMatchObject({ error: true, body: "unavailable" });
  });
});
