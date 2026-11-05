import type {
  McpConnectorMutation,
  McpConnectorRuntime,
  McpOAuthStart,
} from "@octos-org/octoscode-client/inventory";
import {
  afterMutation,
  readSavedConnectors,
  writeSavedConnectors,
} from "./saved-connectors.ts";

/**
 * Connector sign-in over Core's mcp/oauth/* methods. Core runs the whole OAuth
 * exchange and keeps the tokens; this page only opens the provider's sign-in
 * page and hands back the address the provider returns to. No token ever
 * reaches the browser, and the return address is not stored anywhere.
 *
 * The provider returns to `OAUTH_CALLBACK_PATH` on this web origin, in the
 * sign-in window. That page passes the address to the waiting page over a
 * same-origin BroadcastChannel, because the window has no opener: it was cut
 * before the provider's page loaded.
 */
export const OAUTH_CALLBACK_PATH = "/oauth/mcp/callback";
const CHANNEL_NAME = "octoscode.mcp-oauth.v1";
/** How long the sign-in window waits for a page to take its address. */
export const CALLBACK_CLAIM_TIMEOUT_MS = 4_000;

/** Core refuses a return address on this web origin; it then takes a pasted one. */
const REDIRECT_REFUSED =
  /redirect_uri (?:origin is not allowed|must be the allowed web origin|requires a connection Origin)/i;
/** How Core and its MCP client say a connector needs signing in. */
const SIGN_IN_NEEDED =
  /Auth required|no stored OAuth tokens|\b401\b|Unauthorized|invalid_token/i;

export type OAuthTakesEffect = "now" | "restart" | "unknown";
export type OAuthFailure =
  | "https_required"
  | "no_oauth"
  | "denied"
  | "exchange_failed"
  | "lost"
  | "expired"
  | "permission"
  | "other";

export type ConnectorOAuthState =
  | { kind: "starting" }
  | {
      kind: "waiting";
      flowId: string;
      authorizationUrl: string;
      /** The person pastes the return address; nothing comes back by itself. */
      manual: boolean;
      /** The browser refused to open the sign-in window. */
      windowBlocked: boolean;
    }
  | { kind: "completing" }
  | { kind: "authorized"; takesEffect: OAuthTakesEffect }
  | { kind: "revoking" }
  | { kind: "revoked"; takesEffect: OAuthTakesEffect }
  | { kind: "cancelled" }
  | { kind: "failed"; reason: OAuthFailure; detail?: string };

export interface OAuthCommands {
  startOAuth(connectorId: string, redirectUri?: string): Promise<McpOAuthStart>;
  completeOAuth(
    flowId: string,
    callbackUrl: string,
  ): Promise<McpConnectorMutation>;
  cancelOAuth(flowId: string): Promise<void>;
  revokeOAuth(connectorId: string): Promise<McpConnectorMutation>;
}

export interface OAuthChannel {
  postMessage(message: unknown): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  close(): void;
}

/** A window this page opened; only what the flow uses. */
export interface SignInWindow {
  readonly closed: boolean;
  close(): void;
  location: { replace(url: string): void };
}

let openChannel: () => OAuthChannel | null = () =>
  typeof BroadcastChannel === "undefined"
    ? null
    : (new BroadcastChannel(CHANNEL_NAME) as unknown as OAuthChannel);

/** Swaps the channel and forgets every sign-in still waiting. */
export function setOAuthChannelForTests(
  factory: () => OAuthChannel | null,
): void {
  openChannel = factory;
  channel?.close();
  channel = null;
  for (const flow of pending) if (flow.timer) clearTimeout(flow.timer);
  pending.clear();
}

export function needsSignIn(error: string | undefined): boolean {
  return Boolean(error && SIGN_IN_NEEDED.test(error));
}

export function oauthFailure(message: string): OAuthFailure {
  if (/must use https|requires an HTTP connector/i.test(message))
    return "https_required";
  if (/No authorization support detected|metadata discovery/i.test(message))
    return "no_oauth";
  if (/oauth_flow_expired|flow expired/i.test(message)) return "expired";
  if (/oauth_flow not found/i.test(message)) return "lost";
  if (/callback exchange failed/i.test(message)) return "exchange_failed";
  if (/forbidden|permission denied|not authorized|outside the/i.test(message))
    return "permission";
  return "other";
}

export function takesEffect(
  runtime: McpConnectorRuntime | undefined,
): OAuthTakesEffect {
  if (runtime?.restartRequired) return "restart";
  return runtime && !runtime.error ? "now" : "unknown";
}

/** The `state` the provider will echo back, which tells the sign-ins apart. */
export function signInState(authorizationUrl: string): string | null {
  try {
    return new URL(authorizationUrl).searchParams.get("state");
  } catch {
    return null;
  }
}

/** A return address this page may hand to Core: this origin, the callback path. */
export function callbackOnOrigin(value: unknown, origin: string): URL | null {
  if (typeof value !== "string" || value.length > 8_192) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.origin === origin && url.pathname === OAUTH_CALLBACK_PATH
    ? url
    : null;
}

interface Scope {
  states: Map<string, ConnectorOAuthState>;
  /** Connectors a server reply said sign in with OAuth. */
  oauth: Map<string, boolean>;
  listeners: Set<() => void>;
  /** Bumped on every change, for useSyncExternalStore. */
  version: number;
  /** Bumped when a sign-in or revocation changed what the server runs. */
  settled: number;
}

interface Pending {
  connection: object;
  profileId: string;
  connectorId: string;
  flowId: string;
  state: string | null;
  commands: OAuthCommands;
  window: SignInWindow | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const scopes = new WeakMap<object, Map<string, Scope>>();
const pending = new Set<Pending>();
let channel: OAuthChannel | null = null;

function scope(connection: object, profileId: string): Scope {
  let byProfile = scopes.get(connection);
  if (!byProfile) {
    byProfile = new Map();
    scopes.set(connection, byProfile);
  }
  let found = byProfile.get(profileId);
  if (!found) {
    found = {
      states: new Map(),
      oauth: new Map(),
      listeners: new Set(),
      version: 0,
      settled: 0,
    };
    byProfile.set(profileId, found);
  }
  return found;
}

function set(
  connection: object,
  profileId: string,
  connectorId: string,
  state: ConnectorOAuthState,
  settled = false,
) {
  const target = scope(connection, profileId);
  target.states.set(connectorId, state);
  target.version += 1;
  if (settled) target.settled += 1;
  for (const listener of target.listeners) listener();
}

export function connectorOAuthState(
  connection: object,
  profileId: string,
  connectorId: string,
): ConnectorOAuthState | undefined {
  return scopes.get(connection)?.get(profileId)?.states.get(connectorId);
}

/**
 * The provider revoked its side: a status read said this connector needs
 * signing in (T-0371). A remembered "authorized" must not outlive that
 * truth — drop it so the row answers from the server's report instead of
 * claiming a sign-in the provider no longer honours.
 */
export function noteConnectorUnauthorized(
  connection: object,
  profileId: string,
  connectorId: string,
): void {
  const target = scopes.get(connection)?.get(profileId);
  if (target?.states.get(connectorId)?.kind !== "authorized") return;
  target.states.delete(connectorId);
  target.version += 1;
  for (const listener of target.listeners) listener();
}

export function knownToUseOAuth(
  connection: object,
  profileId: string,
  connectorId: string,
): boolean {
  return (
    scopes.get(connection)?.get(profileId)?.oauth.get(connectorId) === true
  );
}

export function oauthSettled(connection: object, profileId: string): number {
  return scopes.get(connection)?.get(profileId)?.settled ?? 0;
}

export function oauthVersion(connection: object, profileId: string): number {
  return scopes.get(connection)?.get(profileId)?.version ?? 0;
}

export function subscribeConnectorOAuth(
  connection: object,
  profileId: string,
  listener: () => void,
): () => void {
  const target = scope(connection, profileId);
  target.listeners.add(listener);
  return () => target.listeners.delete(listener);
}

/** Any connector reply says whether it signs in with OAuth; keep that. */
export function rememberConnectorOAuth(
  connection: object,
  profileId: string,
  mutation: McpConnectorMutation,
): void {
  const connector = mutation.connector;
  if (connector?.oauth === undefined) return;
  scope(connection, profileId).oauth.set(connector.id, connector.oauth);
}

function applyMutation(
  flow: { connection: object; profileId: string; connectorId: string },
  mutation: McpConnectorMutation,
) {
  rememberConnectorOAuth(flow.connection, flow.profileId, mutation);
  writeSavedConnectors(
    flow.connection,
    flow.profileId,
    afterMutation(
      readSavedConnectors(flow.connection, flow.profileId),
      mutation,
      flow.connectorId,
    ),
  );
}

function finish(flow: Pending) {
  pending.delete(flow);
  if (flow.timer) clearTimeout(flow.timer);
  if (!pending.size && channel) {
    channel.close();
    channel = null;
  }
}

function listen(origin: string) {
  if (channel) return;
  channel = openChannel();
  channel?.addEventListener("message", ({ data }) => {
    if (
      typeof data !== "object" ||
      data === null ||
      (data as { type?: unknown }).type !== "callback"
    )
      return;
    const url = callbackOnOrigin((data as { url?: unknown }).url, origin);
    const state = url?.searchParams.get("state");
    if (!url || !state) return;
    const flow = [...pending].find((candidate) => candidate.state === state);
    if (!flow) return;
    channel?.postMessage({ type: "received", state });
    void complete(flow, url);
  });
}

async function complete(flow: Pending, url: URL) {
  finish(flow);
  const { connection, profileId, connectorId } = flow;
  // The provider said no: there is nothing to exchange, so stop the flow here.
  const refused = url.searchParams.get("error");
  if (refused) {
    await flow.commands.cancelOAuth(flow.flowId).catch(() => undefined);
    set(connection, profileId, connectorId, {
      kind: "failed",
      reason: "denied",
      detail: (url.searchParams.get("error_description") || refused).slice(
        0,
        300,
      ),
    });
    return;
  }
  set(connection, profileId, connectorId, { kind: "completing" });
  try {
    const mutation = await flow.commands.completeOAuth(flow.flowId, url.href);
    applyMutation(flow, mutation);
    set(
      connection,
      profileId,
      connectorId,
      { kind: "authorized", takesEffect: takesEffect(mutation.runtime) },
      true,
    );
  } catch (reason) {
    const message = String((reason as Error)?.message ?? reason).slice(0, 512);
    set(connection, profileId, connectorId, {
      kind: "failed",
      reason: oauthFailure(message),
      detail: message,
    });
  }
}

function flowFor(connection: object, profileId: string, connectorId: string) {
  return [...pending].find(
    (flow) =>
      flow.connection === connection &&
      flow.profileId === profileId &&
      flow.connectorId === connectorId,
  );
}

export interface StartConnectorOAuth {
  connection: object;
  profileId: string;
  connectorId: string;
  commands: () => Promise<OAuthCommands>;
  /** This page's origin, where the provider is asked to return. */
  origin: string;
  /** The app is served at the origin's root, so the callback page exists. */
  callbackServed: boolean;
  /** Opened in the click, before any await, so a popup blocker allows it. */
  window: SignInWindow | null;
  now?: () => number;
  /**
   * Server wall time in ms when it can be read (T-0371): the browser clock
   * may be hours off, so the flow expiry — issued in the server's time — is
   * anchored on this answer and only elapsed time is measured locally. When
   * unavailable the browser clock is the fallback.
   */
  serverNow?: () => Promise<number | null>;
}

export async function startConnectorOAuth(
  options: StartConnectorOAuth,
): Promise<void> {
  const { connection, profileId, connectorId, origin } = options;
  const earlier = flowFor(connection, profileId, connectorId);
  if (earlier) {
    finish(earlier);
    void earlier.commands.cancelOAuth(earlier.flowId).catch(() => undefined);
  }
  set(connection, profileId, connectorId, { kind: "starting" });
  let started;
  let commands: OAuthCommands;
  try {
    commands = await options.commands();
    started = options.callbackServed
      ? await commands
          .startOAuth(connectorId, `${origin}${OAUTH_CALLBACK_PATH}`)
          .catch((reason: unknown) => {
            if (!REDIRECT_REFUSED.test(String((reason as Error)?.message)))
              throw reason;
            return commands.startOAuth(connectorId);
          })
      : await commands.startOAuth(connectorId);
  } catch (reason) {
    options.window?.close();
    const message = String((reason as Error)?.message ?? reason).slice(0, 512);
    set(connection, profileId, connectorId, {
      kind: "failed",
      reason: oauthFailure(message),
      detail: message,
    });
    return;
  }
  const manual = started.completion !== "web_origin";
  let windowBlocked = true;
  if (options.window && !options.window.closed) {
    options.window.location.replace(started.authorizationUrl);
    windowBlocked = false;
  }
  const flow: Pending = {
    connection,
    profileId,
    connectorId,
    flowId: started.flowId,
    state: signInState(started.authorizationUrl),
    commands,
    window: options.window,
    timer: null,
  };
  const expiresAt = Date.parse(started.expiresAt ?? "");
  if (Number.isFinite(expiresAt)) {
    // expires_at is server wall time (audit 2026-11-05 #336): the browser
    // clock can be ±1h off, so anchor on the server's answer when it gives
    // one and measure only the elapsed remainder locally.
    const browserNow = (options.now ?? Date.now)();
    const serverNow = options.serverNow
      ? await options.serverNow().catch(() => null)
      : null;
    const skew =
      typeof serverNow === "number" && Number.isFinite(serverNow)
        ? serverNow - browserNow
        : 0;
    flow.timer = setTimeout(
      () => {
        if (!pending.has(flow)) return;
        finish(flow);
        set(connection, profileId, connectorId, {
          kind: "failed",
          reason: "expired",
        });
      },
      Math.max(0, expiresAt - browserNow - skew),
    );
  }
  pending.add(flow);
  if (!manual) listen(origin);
  set(connection, profileId, connectorId, {
    kind: "waiting",
    flowId: started.flowId,
    authorizationUrl: started.authorizationUrl,
    manual,
    windowBlocked,
  });
}

/** The address the person copied after signing in, for a manual sign-in. */
export function completeConnectorOAuthManually(
  connection: object,
  profileId: string,
  connectorId: string,
  address: string,
): boolean {
  const flow = flowFor(connection, profileId, connectorId);
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return false;
  }
  if (!flow || !/^https?:$/.test(url.protocol)) return false;
  void complete(flow, url);
  return true;
}

export async function cancelConnectorOAuth(
  connection: object,
  profileId: string,
  connectorId: string,
): Promise<void> {
  const flow = flowFor(connection, profileId, connectorId);
  if (!flow) return;
  finish(flow);
  // Only closes while the window is still blank: once the provider's page has
  // loaded, the window is cut off from this page and the person closes it.
  if (flow.window && !flow.window.closed) flow.window.close();
  try {
    await flow.commands.cancelOAuth(flow.flowId);
    set(connection, profileId, connectorId, { kind: "cancelled" });
  } catch (reason) {
    const message = String((reason as Error)?.message ?? reason).slice(0, 512);
    set(connection, profileId, connectorId, {
      kind: "failed",
      reason: oauthFailure(message),
      detail: message,
    });
  }
}

export async function revokeConnectorOAuth(
  connection: object,
  profileId: string,
  connectorId: string,
  commands: () => Promise<OAuthCommands>,
): Promise<void> {
  set(connection, profileId, connectorId, { kind: "revoking" });
  try {
    const mutation = await (await commands()).revokeOAuth(connectorId);
    applyMutation({ connection, profileId, connectorId }, mutation);
    set(
      connection,
      profileId,
      connectorId,
      { kind: "revoked", takesEffect: takesEffect(mutation.runtime) },
      true,
    );
  } catch (reason) {
    const message = String((reason as Error)?.message ?? reason).slice(0, 512);
    set(connection, profileId, connectorId, {
      kind: "failed",
      reason: oauthFailure(message),
      detail: message,
    });
  }
}

/** The sign-in window's side: read the address, then take it off the page. */
export function consumeOAuthCallback(
  location: Pick<Location, "pathname" | "href">,
  history: Pick<History, "replaceState">,
): string | null {
  if (location.pathname !== OAUTH_CALLBACK_PATH) return null;
  const href = location.href;
  history.replaceState(null, "", OAUTH_CALLBACK_PATH);
  return href;
}

export type CallbackDelivery = "received" | "unclaimed" | "unsupported";

/** Hand the address to the page waiting for it; it answers when it takes it. */
export function deliverOAuthCallback(
  href: string,
  timeoutMs = CALLBACK_CLAIM_TIMEOUT_MS,
): Promise<CallbackDelivery> {
  const delivery = openChannel();
  if (!delivery) return Promise.resolve("unsupported");
  let state: string | null = null;
  try {
    state = new URL(href).searchParams.get("state");
  } catch {
    state = null;
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      delivery.close();
      resolve("unclaimed");
    }, timeoutMs);
    delivery.addEventListener("message", ({ data }) => {
      if (
        typeof data === "object" &&
        data !== null &&
        (data as { type?: unknown }).type === "received" &&
        (data as { state?: unknown }).state === state
      ) {
        clearTimeout(timer);
        delivery.close();
        resolve("received");
      }
    });
    delivery.postMessage({ type: "callback", url: href });
  });
}
