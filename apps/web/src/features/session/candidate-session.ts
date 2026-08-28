import type {
  RpcNotification,
  SessionHydrateParams,
  SessionHydrateResult,
  SessionOpened,
  SessionOpenParams,
  SessionOpenResult,
} from "@octos-org/octoscode-client";
import type { SessionConnectionInput } from "./connection-lifecycle.ts";

const CANDIDATE_NOTIFICATION_LIMIT = 4_096;
const HYDRATE_INCLUDE: NonNullable<SessionHydrateParams["include"]> = [
  "messages",
  "threads",
  "turns",
  "pending_approvals",
];

export interface CandidateSessionClient {
  connect(): Promise<void>;
  disconnect(): void;
  subscribeNotifications(
    listener: (notification: RpcNotification) => void,
  ): () => void;
  openSession(params: SessionOpenParams): Promise<SessionOpenResult>;
  hydrateSession(params: SessionHydrateParams): Promise<SessionHydrateResult>;
}

export type CandidateSessionClientFactory<
  Client extends CandidateSessionClient = CandidateSessionClient,
> = (config: SessionConnectionInput) => Client;

export interface CandidateSessionSnapshot<
  Client extends CandidateSessionClient = CandidateSessionClient,
> {
  client: Client;
  opened: SessionOpened;
  hydrated: SessionHydrateResult;
  notifications: readonly RpcNotification[];
}

/**
 * A fully connected and hydrated candidate whose transport is still isolated
 * from the active product Session.
 *
 * `release` transfers transport ownership to the caller. Before release,
 * `dispose` (or aborting the supplied signal) always disconnects the candidate.
 */
export interface PreparedCandidateSession<
  Client extends CandidateSessionClient = CandidateSessionClient,
> {
  release(): CandidateSessionSnapshot<Client>;
  dispose(): void;
}

export interface PrepareCandidateSessionOptions<
  Client extends CandidateSessionClient = CandidateSessionClient,
> {
  config: SessionConnectionInput;
  createClient: CandidateSessionClientFactory<Client>;
  signal: AbortSignal;
  validateOpened: (opened: SessionOpened) => void;
}

/**
 * Prepare a Session on an isolated client without mutating product state.
 *
 * Notifications remain buffered until `release`, closing the hydrate/live-event
 * race without exposing an incomplete candidate. Every pre-release failure,
 * cancellation, or buffer overflow fails closed and disconnects the transport.
 */
export async function prepareCandidateSession<
  Client extends CandidateSessionClient,
>(
  options: PrepareCandidateSessionOptions<Client>,
): Promise<PreparedCandidateSession<Client>> {
  throwIfAborted(options.signal);

  const client = options.createClient(options.config);
  const notifications: RpcNotification[] = [];
  let state: "preparing" | "prepared" | "released" | "disposed" = "preparing";
  let terminalError: Error | null = null;
  let unsubscribe: (() => void) | null = null;
  const terminalListeners = new Set<(error: Error) => void>();

  const detachNotificationListener = () => {
    const detach = unsubscribe;
    unsubscribe = null;
    detach?.();
  };

  const disconnect = () => {
    detachNotificationListener();
    options.signal.removeEventListener("abort", abort);
    try {
      client.disconnect();
    } catch {
      // Cleanup is best-effort and must not replace the staging failure.
    }
  };

  const failClosed = (error: Error) => {
    terminalError ??= error;
    if (state === "released" || state === "disposed") return;
    state = "disposed";
    for (const listener of terminalListeners) listener(terminalError);
    terminalListeners.clear();
    disconnect();
  };

  function abort() {
    failClosed(new CandidateSessionCancelledError());
  }

  const assertPreparing = () => {
    if (terminalError) throw terminalError;
    if (options.signal.aborted) {
      abort();
      throw terminalError ?? new CandidateSessionCancelledError();
    }
  };

  const waitForStage = <Value>(operation: Promise<Value>): Promise<Value> => {
    assertPreparing();
    return new Promise<Value>((resolve, reject) => {
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        terminalListeners.delete(fail);
        reject(error);
      };
      terminalListeners.add(fail);
      operation.then(
        (value) => {
          if (settled) return;
          settled = true;
          terminalListeners.delete(fail);
          resolve(value);
        },
        (reason: unknown) => {
          if (settled) return;
          settled = true;
          terminalListeners.delete(fail);
          reject(reason);
        },
      );
    });
  };

  try {
    options.signal.addEventListener("abort", abort, { once: true });
    unsubscribe = client.subscribeNotifications((notification) => {
      if (notifications.length >= CANDIDATE_NOTIFICATION_LIMIT) {
        failClosed(
          new Error(
            "The candidate session emitted too many events while opening.",
          ),
        );
        return;
      }
      notifications.push(notification);
    });
    assertPreparing();

    await waitForStage(client.connect());
    assertPreparing();

    const result = await waitForStage(
      client.openSession(openParams(options.config)),
    );
    assertPreparing();
    options.validateOpened(result.opened);
    assertPreparing();

    const hydrated = await waitForStage(
      client.hydrateSession({
        session_id: result.opened.session_id,
        include: [...HYDRATE_INCLUDE],
      }),
    );
    assertPreparing();
    if (hydrated.session_id !== result.opened.session_id) {
      throw new Error("session/hydrate returned another session");
    }

    state = "prepared";
    return {
      release() {
        if (state !== "prepared") {
          throw terminalError ?? new Error("Candidate session is not prepared");
        }
        assertPreparing();
        state = "released";
        detachNotificationListener();
        options.signal.removeEventListener("abort", abort);
        return {
          client,
          opened: result.opened,
          hydrated,
          notifications: [...notifications],
        };
      },
      dispose() {
        if (state === "released" || state === "disposed") return;
        state = "disposed";
        disconnect();
      },
    };
  } catch (reason) {
    const failure = terminalError ?? asError(reason);
    failClosed(failure);
    throw failure;
  }
}

export class CandidateSessionCancelledError extends Error {
  constructor() {
    super("Candidate session opening was cancelled");
    this.name = "CandidateSessionCancelledError";
  }
}

function openParams(config: SessionConnectionInput): SessionOpenParams {
  return {
    session_id: config.sessionId,
    ...(config.profileId ? { profile_id: config.profileId } : {}),
    ...(config.cwd ? { cwd: config.cwd } : {}),
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CandidateSessionCancelledError();
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
