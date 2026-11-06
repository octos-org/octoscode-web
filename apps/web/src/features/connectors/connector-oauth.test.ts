import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  McpConnectorMutation,
  McpOAuthStart,
} from "@octos-org/octoscode-client/inventory";
import {
  CALLBACK_CLAIM_TIMEOUT_MS,
  OAUTH_CALLBACK_PATH,
  callbackOnOrigin,
  cancelConnectorOAuth,
  completeConnectorOAuthManually,
  connectorOAuthState,
  consumeOAuthCallback,
  deliverOAuthCallback,
  knownToUseOAuth,
  needsSignIn,
  noteConnectorServerStatus,
  oauthFailure,
  oauthSettled,
  oauthVersion,
  revokeConnectorOAuth,
  setOAuthChannelForTests,
  startConnectorOAuth,
  takesEffect,
  type OAuthChannel,
  type OAuthCommands,
  type SignInWindow,
} from "./connector-oauth.ts";
import {
  readSavedConnectors,
  writeSavedConnectors,
} from "./saved-connectors.ts";

const ORIGIN = "https://octos.example";
const RETURN = `${ORIGIN}${OAUTH_CALLBACK_PATH}`;

/** Every channel object shares one bus, as same-origin BroadcastChannels do. */
function bus() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements OAuthChannel {
    listeners: Array<(event: { data: unknown }) => void> = [];
    closed = false;
    constructor() {
      channels.add(this);
    }
    postMessage(message: unknown) {
      for (const other of channels)
        if (other !== this && !other.closed)
          for (const listener of other.listeners) listener({ data: message });
    }
    addEventListener(
      _type: "message",
      listener: (event: { data: unknown }) => void,
    ) {
      this.listeners.push(listener);
    }
    close() {
      this.closed = true;
      channels.delete(this);
    }
  }
  return { open: () => new FakeChannel(), channels };
}

function started(
  state: string,
  completion = "web_origin",
  expiresAt?: string,
): McpOAuthStart {
  return {
    flowId: `flow-${state}`,
    authorizationUrl: `https://provider.example/authorize?client_id=c&state=${state}`,
    redirectUri: RETURN,
    completion,
    ...(expiresAt ? { expiresAt } : {}),
  };
}

const done = (
  fields: Partial<McpConnectorMutation> = {},
): McpConnectorMutation => ({
  created: false,
  deleted: false,
  listed: true,
  completed: true,
  connector: {
    id: "mcp-1",
    name: "Docs",
    enabled: true,
    transport: "http",
    oauth: true,
  },
  runtime: { restartRequired: false, effectiveFrom: "next_turn" },
  ...fields,
});

function fakeCommands(overrides: Partial<OAuthCommands> = {}) {
  return {
    startOAuth: vi.fn(async () => started("s1")),
    completeOAuth: vi.fn(async () => done()),
    cancelOAuth: vi.fn(async () => undefined),
    revokeOAuth: vi.fn(async () => ({
      ...done(),
      completed: false,
      revoked: true,
    })),
    ...overrides,
  } satisfies OAuthCommands;
}

function fakeWindow(): SignInWindow & { replaced: string[] } {
  const replaced: string[] = [];
  return {
    closed: false,
    close: vi.fn(),
    location: { replace: (url: string) => replaced.push(url) },
    replaced,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("connector sign-in", () => {
  let channels: ReturnType<typeof bus>;
  beforeEach(() => {
    channels = bus();
    setOAuthChannelForTests(channels.open);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function begin(
    connection: object,
    commands: OAuthCommands,
    window: SignInWindow | null = fakeWindow(),
  ) {
    await startConnectorOAuth({
      connection,
      profileId: "coding",
      connectorId: "mcp-1",
      commands: async () => commands,
      origin: ORIGIN,
      callbackServed: true,
      window,
    });
  }

  function returnFromProvider(query: string) {
    const page = channels.open();
    page.postMessage({ type: "callback", url: `${RETURN}?${query}` });
    page.close();
  }

  it("asks the provider to return to this origin and opens its page in the window", async () => {
    const connection = {};
    const commands = fakeCommands();
    const window = fakeWindow();
    await begin(connection, commands, window);
    expect(commands.startOAuth).toHaveBeenCalledWith("mcp-1", RETURN);
    expect(window.replaced).toEqual([started("s1").authorizationUrl]);
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toMatchObject({
      kind: "waiting",
      manual: false,
      windowBlocked: false,
    });
  });

  it("completes when the provider returns with this sign-in's state", async () => {
    const connection = {};
    const commands = fakeCommands();
    await begin(connection, commands);
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(commands.completeOAuth).toHaveBeenCalledWith(
      "flow-s1",
      `${RETURN}?code=c&state=s1`,
    );
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "now",
    });
    expect(knownToUseOAuth(connection, "coding", "mcp-1")).toBe(true);
    expect(oauthSettled(connection, "coding")).toBe(1);
  });

  it("measures the flow expiry on the server's clock, not the browser's", async () => {
    // T-0371: a browser one hour AHEAD used to fail the sign-in instantly;
    // one hour BEHIND kept waiting an hour past the server's expiry.
    vi.useFakeTimers();
    const expiry = "2026-11-04T13:10:00Z";
    const start = (connection: object, browserNow: string) =>
      startConnectorOAuth({
        connection,
        profileId: "coding",
        connectorId: "mcp-1",
        commands: async () =>
          fakeCommands({
            startOAuth: vi.fn(async () => started("s1", "web_origin", expiry)),
          }),
        origin: ORIGIN,
        callbackServed: true,
        window: fakeWindow(),
        now: () => Date.parse(browserNow),
        serverNow: async () => Date.parse("2026-11-04T13:00:00Z"),
      });

    const ahead = {};
    await start(ahead, "2026-11-04T14:00:00Z");
    expect(connectorOAuthState(ahead, "coding", "mcp-1")?.kind).toBe("waiting");
    vi.advanceTimersByTime(9 * 60_000);
    expect(connectorOAuthState(ahead, "coding", "mcp-1")?.kind).toBe("waiting");
    vi.advanceTimersByTime(60_000);
    expect(connectorOAuthState(ahead, "coding", "mcp-1")).toEqual({
      kind: "failed",
      reason: "expired",
    });

    const behind = {};
    await start(behind, "2026-11-04T12:00:00Z");
    vi.advanceTimersByTime(10 * 60_000);
    expect(connectorOAuthState(behind, "coding", "mcp-1")).toEqual({
      kind: "failed",
      reason: "expired",
    });
  });

  it("lets the server's structured status decide a remembered sign-in", async () => {
    // T-0430: a failed status ends a LIVE sign-in (provider revoked, refresh
    // failed — any wording); a restart-pending one survives it and settles
    // once the server reports connected. Error text is never consulted.
    const connection = {};
    const commands = fakeCommands();
    await begin(connection, commands);
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "now",
    });

    const before = oauthVersion(connection, "coding");
    noteConnectorServerStatus(connection, "coding", "mcp-1", "failed");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toBeUndefined();
    expect(oauthVersion(connection, "coding")).toBe(before + 1);
    // Already cleared: a second report changes nothing.
    noteConnectorServerStatus(connection, "coding", "mcp-1", "failed");
    expect(oauthVersion(connection, "coding")).toBe(before + 1);
  });

  it("keeps a restart-pending sign-in through a stale failure, then settles it on connected", async () => {
    const connection = {};
    const commands = fakeCommands({
      completeOAuth: vi.fn(async () =>
        done({
          runtime: { restartRequired: true, effectiveFrom: "next_turn" },
        }),
      ),
    });
    await begin(connection, commands);
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "restart",
    });

    // The still-running old connection reports failed until the restart;
    // the stored sign-in must keep its restart note instead of vanishing.
    noteConnectorServerStatus(connection, "coding", "mcp-1", "failed");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "restart",
    });

    // Once the server confirms the connection is live, it is simply signed in.
    noteConnectorServerStatus(connection, "coding", "mcp-1", "connected");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "now",
    });
  });

  it("ignores another sign-in's return, and one from another origin", async () => {
    const connection = {};
    const commands = fakeCommands();
    await begin(connection, commands);
    returnFromProvider("code=c&state=someone-else");
    const page = channels.open();
    page.postMessage({
      type: "callback",
      url: `https://evil.example${OAUTH_CALLBACK_PATH}?code=c&state=s1`,
    });
    page.postMessage({
      type: "callback",
      url: `${ORIGIN}/elsewhere?code=c&state=s1`,
    });
    page.close();
    await flush();
    expect(commands.completeOAuth).not.toHaveBeenCalled();
    expect(connectorOAuthState(connection, "coding", "mcp-1")?.kind).toBe(
      "waiting",
    );
  });

  it("a refusal at the provider cancels the flow instead of exchanging", async () => {
    const connection = {};
    const commands = fakeCommands();
    await begin(connection, commands);
    returnFromProvider("error=access_denied&error_description=No&state=s1");
    await flush();
    expect(commands.completeOAuth).not.toHaveBeenCalled();
    expect(commands.cancelOAuth).toHaveBeenCalledWith("flow-s1");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "failed",
      reason: "denied",
      detail: "No",
    });
  });

  it("a failed exchange keeps Core's reason", async () => {
    const connection = {};
    const message =
      "OAuth callback exchange failed: OAuth token exchange failed: invalid_grant";
    const commands = fakeCommands({
      completeOAuth: vi.fn(async () => {
        throw new Error(message);
      }),
    });
    await begin(connection, commands);
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "failed",
      reason: "exchange_failed",
      detail: message,
    });
    expect(oauthSettled(connection, "coding")).toBe(0);
  });

  it("falls back to a pasted address when Core refuses this origin", async () => {
    const connection = {};
    const startOAuth = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("redirect_uri origin is not allowed for this connection"),
      )
      .mockResolvedValueOnce(started("s2", "manual_callback_url"));
    const commands = fakeCommands({ startOAuth });
    await begin(connection, commands);
    expect(startOAuth.mock.calls).toEqual([["mcp-1", RETURN], ["mcp-1"]]);
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toMatchObject({
      kind: "waiting",
      manual: true,
    });
    expect(
      completeConnectorOAuthManually(connection, "coding", "mcp-1", "nope"),
    ).toBe(false);
    expect(
      completeConnectorOAuthManually(
        connection,
        "coding",
        "mcp-1",
        " http://127.0.0.1/oauth/mcp/callback?code=c&state=s2 ",
      ),
    ).toBe(true);
    await flush();
    expect(commands.completeOAuth).toHaveBeenCalledWith(
      "flow-s2",
      "http://127.0.0.1/oauth/mcp/callback?code=c&state=s2",
    );
  });

  it("does not retry other start failures, and closes the blank window", async () => {
    const connection = {};
    const window = fakeWindow();
    const commands = fakeCommands({
      startOAuth: vi.fn(async () => {
        throw new Error("OAuth MCP endpoints must use https");
      }),
    });
    await begin(connection, commands, window);
    expect(commands.startOAuth).toHaveBeenCalledTimes(1);
    expect(window.close).toHaveBeenCalled();
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toMatchObject({
      kind: "failed",
      reason: "https_required",
    });
  });

  it("says when the browser blocked the window", async () => {
    const connection = {};
    await begin(connection, fakeCommands(), null);
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toMatchObject({
      kind: "waiting",
      windowBlocked: true,
    });
  });

  it("cancels on the server and ignores a later return", async () => {
    const connection = {};
    const commands = fakeCommands();
    await begin(connection, commands);
    await cancelConnectorOAuth(connection, "coding", "mcp-1");
    expect(commands.cancelOAuth).toHaveBeenCalledWith("flow-s1");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "cancelled",
    });
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(commands.completeOAuth).not.toHaveBeenCalled();
  });

  it("expires with the flow", async () => {
    vi.useFakeTimers();
    const connection = {};
    await startConnectorOAuth({
      connection,
      profileId: "coding",
      connectorId: "mcp-1",
      commands: async () =>
        fakeCommands({
          startOAuth: vi.fn(async () =>
            started("s1", "web_origin", "2026-11-04T13:10:00Z"),
          ),
        }),
      origin: ORIGIN,
      callbackServed: true,
      window: fakeWindow(),
      now: () => Date.parse("2026-11-04T13:00:00Z"),
    });
    vi.advanceTimersByTime(10 * 60_000);
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "failed",
      reason: "expired",
    });
  });

  it("a sign-in on a server that loads at restart says so, and updates its saved row", async () => {
    const connection = {};
    writeSavedConnectors(connection, "coding", [
      {
        id: "mcp-1",
        name: "Docs",
        transport: "http",
        enabled: true,
        url: "https://docs.example/mcp",
        takesEffect: "restart",
      },
    ]);
    const commands = fakeCommands({
      completeOAuth: vi.fn(async () =>
        done({
          listed: false,
          runtime: { restartRequired: true, effectiveFrom: "next_turn" },
        }),
      ),
    });
    await begin(connection, commands);
    returnFromProvider("code=c&state=s1");
    await flush();
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "authorized",
      takesEffect: "restart",
    });
    expect(readSavedConnectors(connection, "coding")).toHaveLength(1);
  });

  it("revokes", async () => {
    const connection = {};
    const commands = fakeCommands();
    await revokeConnectorOAuth(
      connection,
      "coding",
      "mcp-1",
      async () => commands,
    );
    expect(commands.revokeOAuth).toHaveBeenCalledWith("mcp-1");
    expect(connectorOAuthState(connection, "coding", "mcp-1")).toEqual({
      kind: "revoked",
      takesEffect: "now",
    });
    expect(oauthSettled(connection, "coding")).toBe(1);
  });

  it("keeps sign-ins apart per connection and profile", async () => {
    const first = {};
    await begin(first, fakeCommands());
    expect(connectorOAuthState({}, "coding", "mcp-1")).toBeUndefined();
    expect(connectorOAuthState(first, "other", "mcp-1")).toBeUndefined();
  });
});

describe("the sign-in window's page", () => {
  it("takes the address off the page before anything renders", () => {
    const replaceState = vi.fn();
    expect(
      consumeOAuthCallback(
        { pathname: OAUTH_CALLBACK_PATH, href: `${RETURN}?code=c&state=s` },
        { replaceState },
      ),
    ).toBe(`${RETURN}?code=c&state=s`);
    expect(replaceState).toHaveBeenCalledWith(null, "", OAUTH_CALLBACK_PATH);
    expect(
      consumeOAuthCallback({ pathname: "/", href: ORIGIN }, { replaceState }),
    ).toBe(null);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("hands the address over and hears back from the page that took it", async () => {
    const channels = bus();
    setOAuthChannelForTests(channels.open);
    const waiting = channels.open();
    waiting.addEventListener("message", ({ data }) => {
      const url = new URL((data as { url: string }).url);
      waiting.postMessage({
        type: "received",
        state: url.searchParams.get("state"),
      });
    });
    await expect(
      deliverOAuthCallback(`${RETURN}?code=c&state=s`),
    ).resolves.toBe("received");
  });

  it("says when no page took it, or the browser can't pass it on", async () => {
    vi.useFakeTimers();
    setOAuthChannelForTests(bus().open);
    const unclaimed = deliverOAuthCallback(`${RETURN}?code=c&state=s`);
    vi.advanceTimersByTime(CALLBACK_CLAIM_TIMEOUT_MS);
    await expect(unclaimed).resolves.toBe("unclaimed");
    vi.useRealTimers();
    setOAuthChannelForTests(() => null);
    await expect(deliverOAuthCallback(`${RETURN}?code=c`)).resolves.toBe(
      "unsupported",
    );
  });
});

describe("what Core says", () => {
  it("recognizes a connector that needs signing in", () => {
    expect(
      needsSignIn(
        "MCP initialize failed: Send message error Transport [...] error: Auth required, when send initialize request",
      ),
    ).toBe(true);
    expect(
      needsSignIn(
        "no stored OAuth tokens for MCP server 'https://x/mcp'; run `octos mcp login https://x/mcp` first",
      ),
    ).toBe(true);
    expect(needsSignIn("connection refused")).toBe(false);
    expect(needsSignIn(undefined)).toBe(false);
  });

  it("maps Core's sign-in errors", () => {
    expect(oauthFailure("OAuth MCP endpoints must use https")).toBe(
      "https_required",
    );
    expect(
      oauthFailure("OAuth start failed: No authorization support detected"),
    ).toBe("no_oauth");
    expect(oauthFailure("oauth_flow not found: f")).toBe("lost");
    expect(oauthFailure("OAuth flow expired")).toBe("expired");
    expect(oauthFailure("OAuth callback exchange failed: x")).toBe(
      "exchange_failed",
    );
    expect(oauthFailure("OAuth flow is outside the session/profile")).toBe(
      "permission",
    );
    expect(oauthFailure("something else")).toBe("other");
  });

  it("believes a restart requirement over the next-turn promise", () => {
    expect(
      takesEffect({ restartRequired: true, effectiveFrom: "next_turn" }),
    ).toBe("restart");
    expect(
      takesEffect({ restartRequired: false, effectiveFrom: "next_turn" }),
    ).toBe("now");
    expect(
      takesEffect({ restartRequired: false, error: "rebuild failed" }),
    ).toBe("unknown");
    expect(takesEffect(undefined)).toBe("unknown");
  });

  it("accepts a return address only on this origin and path", () => {
    expect(callbackOnOrigin(`${RETURN}?code=c`, ORIGIN)?.href).toBe(
      `${RETURN}?code=c`,
    );
    expect(
      callbackOnOrigin("https://evil.example/oauth/mcp/callback", ORIGIN),
    ).toBe(null);
    expect(callbackOnOrigin(`${ORIGIN}/oauth/mcp/other`, ORIGIN)).toBe(null);
    expect(callbackOnOrigin(42, ORIGIN)).toBe(null);
  });
});
