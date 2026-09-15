import { describe, expect, it } from "vitest";
import { resolveActiveSessionKey } from "./active-session-key.ts";

describe("resolveActiveSessionKey (fork receipt selection pin, 0555)", () => {
  const opened = {
    workspace_root: "/srv/work/history-fork-receipt",
    active_profile_id: "",
    session_id: "_main:api:web-2416fafe-abe1-4376-bed7-f65403b60206",
  };
  // Exact App.tsx workspaceSessionKey format (JSON.stringify triple).
  const key = JSON.stringify([
    opened.workspace_root,
    opened.active_profile_id,
    opened.session_id,
  ]);

  it("derives the session key from session.opened when present", () => {
    expect(resolveActiveSessionKey(opened, opened.workspace_root, null, false)).toBe(key);
    // activeWorkspacePath (not opened.workspace_root) is canonical, and the
    // historyMutating flag never overrides a PRESENT opened record.
    expect(resolveActiveSessionKey(opened, "", null, false)).not.toBe(key);
    expect(resolveActiveSessionKey(opened, "", null, true)).toBe(
      JSON.stringify(["", "", opened.session_id]),
    );
  });

  it("returns null on a plain absence (no history mutating, no prior key)", () => {
    expect(resolveActiveSessionKey(null, "/srv/work", null, false)).toBeNull();
  });

  it("keeps the PREVIOUS key when session.opened is transiently absent while the history view is mutating (fork receipt)", () => {
    // The exact e2e failure: during the fork dialog's applying/reconcile
    // window, session.opened flickers absent; every sidebar row lost
    // aria-current="page". The prior key must survive the window.
    expect(resolveActiveSessionKey(null, "/srv/work", key, true)).toBe(key);
  });

  it("does not resurrect a key after the history window closes (plain absence again)", () => {
    expect(resolveActiveSessionKey(null, "/srv/work", key, false)).toBeNull();
  });
});