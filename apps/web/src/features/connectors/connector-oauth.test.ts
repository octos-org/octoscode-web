import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  McpConnectorMutation,
  McpOAuthStart,
} from "@octos-org/octoscode-client/inventory";
import {
  OAUTH_CALLBACK_PATH,
  connectorOAuthState,
  setOAuthChannelForTests,
  startConnectorOAuth,
  type OAuthChannel,
  type OAuthCommands,
  type SignInWindow,
} from "./connector-oauth.ts";

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
});
