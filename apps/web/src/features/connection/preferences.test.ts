import { describe, expect, it } from "vitest";
import type { ConnectionDraft } from "./ConnectionPanel.tsx";
import {
  rememberTabTurn,
  wasTurnSentFromTab,
  clearConnectionPreferences,
  clearKnownSessions,
  forgetKnownSession,
  loadAutoConnect,
  loadConnectionPreferences,
  loadComposerDrafts,
  loadDraftPrincipal,
  loadKnownSessions,
  rememberKnownSession,
  rememberDraftPrincipal,
  saveConnectionPreferences,
  saveComposerDrafts,
  setAutoConnect,
  type StorageLike,
} from "./preferences.ts";

const defaults: ConnectionDraft = {
  endpoint: "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

describe("connection preferences", () => {
  it("keeps turn provenance in this tab and exact identity/session scope, never across Forget", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const identity = { ...defaults, token: "first-secret" };
    const receipt = {
      sessionId: "session-a",
      profileId: "coding",
      cwd: "/repo",
      turnId: crypto.randomUUID(),
    };
    saveConnectionPreferences(identity, durable, tab);
    expect(rememberTabTurn(tab, identity, receipt)).toBe(true);
    saveConnectionPreferences({ ...identity, cwd: "/other" }, durable, tab);
    expect(wasTurnSentFromTab(tab, identity, receipt)).toBe(true);
    expect(wasTurnSentFromTab(new MemoryStorage(), identity, receipt)).toBe(
      false,
    );
    expect([...durable.values.values()].join("")).not.toContain(receipt.turnId);
    for (const changed of [
      { sessionId: "session-b" },
      { profileId: "other" },
      { cwd: "/other" },
      { turnId: crypto.randomUUID() },
    ])
      expect(
        wasTurnSentFromTab(tab, identity, { ...receipt, ...changed }),
      ).toBe(false);
    for (const changed of [
      { token: "new-token" },
      { endpoint: "https://elsewhere.example" },
    ]) {
      expect(
        wasTurnSentFromTab(tab, { ...identity, ...changed }, receipt),
      ).toBe(false);
      expect(rememberTabTurn(tab, { ...identity, ...changed }, receipt)).toBe(
        false,
      );
    }
    const next = { ...receipt, turnId: crypto.randomUUID() };
    expect(rememberTabTurn(tab, identity, next)).toBe(true);
    expect(wasTurnSentFromTab(tab, identity, receipt)).toBe(false);
    saveConnectionPreferences(
      { ...identity, token: "new-token" },
      durable,
      tab,
    );
    expect(rememberTabTurn(tab, identity, receipt)).toBe(false);
    expect(
      wasTurnSentFromTab(tab, { ...identity, token: "new-token" }, next),
    ).toBe(false);
    saveConnectionPreferences(identity, durable, tab);
    expect(wasTurnSentFromTab(tab, identity, next)).toBe(false);
    expect(rememberTabTurn(tab, identity, next)).toBe(true);
    clearConnectionPreferences(durable, tab);
    expect(wasTurnSentFromTab(tab, identity, next)).toBe(false);
  });

  it("bounds provenance and reports denied or invalid writes", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(defaults, durable, tab);
    const receipt = {
      sessionId: "session-0",
      profileId: "coding",
      cwd: "/repo",
      turnId: crypto.randomUUID(),
    };
    expect(
      rememberTabTurn(tab, defaults, { ...receipt, turnId: "bad-id" }),
    ).toBe(false);
    expect(
      rememberTabTurn(tab, defaults, { ...receipt, cwd: "x".repeat(4097) }),
    ).toBe(false);
    expect(rememberTabTurn(new ThrowingStorage(), defaults, receipt)).toBe(
      false,
    );
    const blocked = {
      getItem: (key: string) => tab.getItem(key),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(rememberTabTurn(blocked, defaults, receipt)).toBe(false);
    for (let index = 0; index < 65; index++)
      expect(
        rememberTabTurn(tab, defaults, {
          ...receipt,
          sessionId: `session-${index}`,
        }),
      ).toBe(true);
    expect(wasTurnSentFromTab(tab, defaults, receipt)).toBe(false);
    expect(
      wasTurnSentFromTab(tab, defaults, {
        ...receipt,
        sessionId: "session-64",
      }),
    ).toBe(true);
    const key = "octoscode-web.tab-connection.v3";
    const value = JSON.parse(tab.getItem(key)!);
    value.sentTurns = [
      { ...receipt, turnId: "invalid" },
      null,
      { ...receipt, cwd: 42 },
    ];
    tab.setItem(key, JSON.stringify(value));
    expect(wasTurnSentFromTab(tab, defaults, receipt)).toBe(false);
  });

  it("keeps unsent drafts only in the matching tab identity and clears them on token change or Forget", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const identity = { ...defaults, token: "first-secret" };
    const drafts: [string, string][] = [
      ["scoped-session", "  私有草稿\n保留空白  "],
    ];
    saveConnectionPreferences(identity, durable, tab);
    rememberDraftPrincipal(tab, identity, "confirmed-user");
    expect(saveComposerDrafts(tab, identity, drafts)).toBe(true);
    saveConnectionPreferences({ ...identity, cwd: "/another" }, durable, tab);
    expect(loadComposerDrafts(tab, identity)).toEqual(drafts);
    expect(loadDraftPrincipal(tab, identity)).toBe("confirmed-user");
    expect(
      loadDraftPrincipal(tab, { ...identity, token: "another-secret" }),
    ).toBeNull();
    expect([...durable.values.values()].join("")).not.toContain("私有草稿");
    expect(
      loadComposerDrafts(tab, { ...identity, token: "another-secret" }),
    ).toEqual([]);
    expect(
      loadComposerDrafts(tab, {
        ...identity,
        endpoint: "https://other.example",
      }),
    ).toEqual([]);
    expect(
      saveComposerDrafts(tab, { ...identity, token: "another-secret" }, drafts),
    ).toBe(false);
    saveConnectionPreferences(
      { ...identity, token: "another-secret" },
      durable,
      tab,
    );
    expect(
      loadDraftPrincipal(tab, { ...identity, token: "another-secret" }),
    ).toBeNull();
    expect(
      loadComposerDrafts(tab, { ...identity, token: "another-secret" }),
    ).toEqual([]);
    clearConnectionPreferences(durable, tab);
    expect(loadComposerDrafts(tab, identity)).toEqual([]);
  });

  it("reports failed draft writes and leaves oversized input untruncated", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(defaults, durable, tab);
    expect(
      saveComposerDrafts(tab, defaults, [["session", "x".repeat(524_288)]]),
    ).toBe(false);
    const blocked = {
      getItem: (key: string) => tab.getItem(key),
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(saveComposerDrafts(blocked, defaults, [["session", "draft"]])).toBe(
      false,
    );
    expect(
      saveComposerDrafts(new ThrowingStorage(), defaults, [
        ["session", "draft"],
      ]),
    ).toBe(false);
  });
  it("keeps only origin durably and scopes credentials plus session to the tab", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const value = {
      endpoint: "https://octos.example",
      token: "secret",
      sessionId: "web-session",
      profileId: "coding",
      cwd: "/srv/work/octoscode-web",
    };

    saveConnectionPreferences(value, durable, tab);

    expect(loadConnectionPreferences(defaults, durable, tab)).toEqual(value);
    expect(durable.getItem("octoscode-web.connection.v2")).toBe(
      '{"version":2,"endpoint":"https://octos.example"}',
    );
    expect([...tab.values.keys()]).toEqual(["octoscode-web.tab-connection.v3"]);
    expect(
      loadConnectionPreferences(defaults, durable, new MemoryStorage()),
    ).toEqual({
      ...defaults,
      endpoint: "https://octos.example",
    });
  });

  it("fails closed to defaults for corrupt, oversized, or unavailable storage", () => {
    const corrupt = new MemoryStorage();
    corrupt.setItem("octoscode-web.connection.v2", "not json");
    expect(
      loadConnectionPreferences(defaults, corrupt, new ThrowingStorage()),
    ).toEqual(defaults);

    const oversized = new MemoryStorage();
    oversized.setItem(
      "octoscode-web.connection.v2",
      JSON.stringify({
        version: 2,
        endpoint: "x".repeat(2_049),
      }),
    );
    expect(
      loadConnectionPreferences(defaults, oversized, new MemoryStorage()),
    ).toEqual(defaults);
  });

  it("does not restore session metadata from the legacy durable record", () => {
    const durable = new MemoryStorage();
    durable.setItem(
      "octoscode-web.connection.v1",
      JSON.stringify({
        version: 1,
        endpoint: "https://old.example",
        sessionId: "private-session",
        profileId: "private-profile",
        cwd: "/private/workspace",
      }),
    );

    expect(
      loadConnectionPreferences(defaults, durable, new MemoryStorage()),
    ).toEqual(defaults);
  });

  it("keeps a tab credential bound to the origin saved with that tab", () => {
    const durable = new MemoryStorage();
    const tabA = new MemoryStorage();
    const tabB = new MemoryStorage();
    saveConnectionPreferences(
      {
        ...defaults,
        endpoint: "https://a.example",
        token: "token-a",
        sessionId: "session-a",
        cwd: "/srv/a",
      },
      durable,
      tabA,
    );
    saveConnectionPreferences(
      {
        ...defaults,
        endpoint: "https://b.example",
        token: "token-b",
        sessionId: "session-b",
        cwd: "/srv/b",
      },
      durable,
      tabB,
    );

    expect(loadConnectionPreferences(defaults, durable, tabA)).toMatchObject({
      endpoint: "https://a.example",
      token: "token-a",
      sessionId: "session-a",
      cwd: "/srv/a",
    });
  });

  it("invalidates automatic restore when the tab identity changes", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(
      { ...defaults, endpoint: "https://a.example", token: "token-a" },
      durable,
      tab,
    );
    setAutoConnect(tab, true);
    expect(loadAutoConnect(tab)).toBe(true);

    saveConnectionPreferences(
      { ...defaults, endpoint: "https://b.example", token: "token-b" },
      durable,
      tab,
    );

    expect(loadAutoConnect(tab)).toBe(false);
    expect(loadConnectionPreferences(defaults, durable, tab)).toMatchObject({
      endpoint: "https://b.example",
      token: "token-b",
    });
  });

  it("never remembers credentials pasted into an address or reconnects a replaced draft", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    saveConnectionPreferences(defaults, durable, tab);
    setAutoConnect(tab, true);
    saveConnectionPreferences(
      { ...defaults, endpoint: "https://example.test?token=pasted-secret" },
      durable,
      tab,
    );
    expect([...durable.values.values()].join("")).not.toContain(
      "pasted-secret",
    );
    expect([...tab.values.values()].join("")).not.toContain("pasted-secret");
    expect(loadAutoConnect(tab)).toBe(false);
    expect(loadConnectionPreferences(defaults, durable, tab).endpoint).toBe(
      defaults.endpoint,
    );
  });

  it("keeps confirmed Sessions in the exact tab credential envelope", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const identity = {
      endpoint: "https://octos.example",
      token: "token-a",
    };
    saveConnectionPreferences({ ...defaults, ...identity }, durable, tab);

    rememberKnownSession(
      tab,
      identity,
      {
        session_id: "coding:api:web-one",
        active_profile_id: "coding",
        workspace_root: "/srv/work/one",
      },
      42,
    );

    expect(loadKnownSessions(tab, identity)).toEqual([
      {
        sessionId: "coding:api:web-one",
        profileId: "coding",
        workspaceRoot: "/srv/work/one",
        lastOpenedAt: 42,
      },
    ]);
    expect(loadKnownSessions(tab, { ...identity, token: "token-b" })).toEqual(
      [],
    );
    expect([...tab.values.keys()]).toEqual(["octoscode-web.tab-connection.v3"]);
  });

  it("forgets one deleted Session and keeps the rest of the registry", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const identity = { endpoint: "https://octos.example", token: "token-a" };
    saveConnectionPreferences({ ...defaults, ...identity }, durable, tab);
    for (const [name, at] of [
      ["one", 41],
      ["two", 42],
    ] as const) {
      rememberKnownSession(
        tab,
        identity,
        {
          session_id: `coding:api:web-${name}`,
          active_profile_id: "coding",
          workspace_root: "/srv/work",
        },
        at,
      );
    }

    expect(
      forgetKnownSession(tab, { ...identity, token: "token-b" }, "x"),
    ).toEqual([]);
    expect(
      forgetKnownSession(tab, identity, "coding:api:web-one").map(
        (entry) => entry.sessionId,
      ),
    ).toEqual(["coding:api:web-two"]);
    expect(
      loadKnownSessions(tab, identity).map((entry) => entry.sessionId),
    ).toEqual(["coding:api:web-two"]);
  });

  it("atomically drops the registry when endpoint or token identity changes", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const original = {
      ...defaults,
      endpoint: "https://octos.example",
      token: "token-a",
    };
    saveConnectionPreferences(original, durable, tab);
    rememberKnownSession(
      tab,
      original,
      {
        session_id: "coding:api:web-private",
        active_profile_id: "coding",
        workspace_root: "/srv/private",
      },
      42,
    );

    const next = { ...original, token: "token-b" };
    saveConnectionPreferences(next, durable, tab);

    expect(loadKnownSessions(tab, original)).toEqual([]);
    expect(loadKnownSessions(tab, next)).toEqual([]);
    expect(tab.getItem("octoscode-web.tab-connection.v3")).not.toContain(
      "web-private",
    );
  });

  it("never aliases an oversized credential by its stored prefix", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const prefix = "x".repeat(16_384);
    const original = { ...defaults, token: `${prefix}a` };
    saveConnectionPreferences(original, durable, tab);
    rememberKnownSession(
      tab,
      original,
      {
        session_id: "coding:api:web-private",
        active_profile_id: "coding",
        workspace_root: "/srv/private",
      },
      42,
    );

    expect(loadKnownSessions(tab, original)).toEqual([]);
    expect(
      loadKnownSessions(tab, { ...original, token: `${prefix}b` }),
    ).toEqual([]);
  });

  it("clears only a registry owned by the supplied identity", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    const identity = {
      ...defaults,
      endpoint: "https://octos.example",
      token: "token-a",
    };
    saveConnectionPreferences(identity, durable, tab);
    rememberKnownSession(
      tab,
      identity,
      {
        session_id: "coding:api:web-one",
        active_profile_id: "coding",
        workspace_root: "/srv/work/one",
      },
      42,
    );

    clearKnownSessions(tab, { ...identity, token: "token-b" });
    expect(loadKnownSessions(tab, identity)).toHaveLength(1);
    clearKnownSessions(tab, identity);
    expect(loadKnownSessions(tab, identity)).toEqual([]);
  });

  it("migrates the v2 tab connection without legacy Session metadata", () => {
    const durable = new MemoryStorage();
    const tab = new MemoryStorage();
    tab.setItem(
      "octoscode-web.tab-connection.v2",
      JSON.stringify({
        version: 2,
        endpoint: "https://octos.example",
        token: "token-a",
        sessionId: "coding:api:web-current",
        profileId: "coding",
        cwd: "/srv/work/current",
        autoConnect: true,
      }),
    );

    expect(loadConnectionPreferences(defaults, durable, tab)).toMatchObject({
      endpoint: "https://octos.example",
      token: "token-a",
      sessionId: "coding:api:web-current",
    });
    expect(
      loadKnownSessions(tab, {
        endpoint: "https://octos.example",
        token: "token-a",
      }),
    ).toEqual([]);

    setAutoConnect(tab, true);
    expect(tab.getItem("octoscode-web.tab-connection.v2")).toBeNull();
    expect(tab.getItem("octoscode-web.tab-connection.v3")).not.toBeNull();
  });
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ThrowingStorage implements StorageLike {
  getItem(): string | null {
    throw new Error("storage unavailable");
  }

  setItem(): void {
    throw new Error("storage unavailable");
  }

  removeItem(): void {
    throw new Error("storage unavailable");
  }
}
