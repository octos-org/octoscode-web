import { useRef, useState } from "react";
import {
  DEFAULT_UI_FEATURES,
  OctosUiClient,
  type ConnectionStatus,
  type RpcNotification,
  type SessionOpened,
} from "@octos-org/octoscode-client";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
import {
  EventInspector,
  type ObservedEvent,
} from "../features/inspector/EventInspector.tsx";
import { Timeline } from "../features/timeline/Timeline.tsx";
import {
  addOptimisticUser,
  addSystemMessage,
  foldNotification,
  terminalTurnId,
  type TimelineEntry,
} from "../features/timeline/model.ts";
import { resolveComposerIntent } from "../features/composer/intent.ts";
import {
  PromptTurnQueue,
  type PromptTurn,
  type PromptTurnQueueSnapshot,
} from "../features/composer/turn-queue.ts";

const initialConnection: ConnectionDraft = {
  endpoint: "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

export function App() {
  const clientRef = useRef<OctosUiClient | null>(null);
  const eventId = useRef(0);
  const draftRef = useRef("");
  const sessionIdRef = useRef("");
  const queueRef = useRef(new PromptTurnQueue());
  const interruptingTurnIdRef = useRef<string | null>(null);
  const [connection, setConnection] = useState(initialConnection);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SessionOpened | null>(null);
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [queue, setQueue] = useState<PromptTurnQueueSnapshot>(() =>
    queueRef.current.snapshot(),
  );
  const [interruptingTurnId, setInterruptingTurnId] = useState<string | null>(
    null,
  );

  const syncQueue = () => setQueue(queueRef.current.snapshot());

  const resetQueue = () => {
    queueRef.current.clear();
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    syncQueue();
  };

  const connect = async () => {
    clientRef.current?.disconnect();
    setConnectionError(null);
    setOpened(null);
    setEvents([]);
    setTimeline([]);
    resetQueue();

    const client = new OctosUiClient({
      endpoint: connection.endpoint.trim(),
      token: connection.token,
      features: DEFAULT_UI_FEATURES,
    });
    clientRef.current = client;
    client.subscribeStatus(setStatus);
    client.subscribeErrors((error) => setConnectionError(error.message));
    client.subscribeNotifications(handleNotification);

    try {
      await client.connect();
      const result = await client.openSession({
        session_id: connection.sessionId.trim(),
        ...(connection.profileId.trim()
          ? { profile_id: connection.profileId.trim() }
          : {}),
        ...(connection.cwd.trim() ? { cwd: connection.cwd.trim() } : {}),
      });
      sessionIdRef.current = result.opened.session_id;
      setOpened(result.opened);
      setTimeline((current) =>
        addSystemMessage(
          current,
          "session-opened",
          "Workspace connected",
          result.opened.workspace_root ||
            connection.cwd.trim() ||
            result.opened.session_id,
          "complete",
        ),
      );
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setConnectionError(message);
      client.disconnect();
    }
  };

  const disconnect = () => {
    clientRef.current?.disconnect();
    clientRef.current = null;
    setOpened(null);
    sessionIdRef.current = "";
    resetQueue();
  };

  const submit = () => {
    const text = draftRef.current.trim();
    if (!clientRef.current || status !== "connected" || !opened || !text)
      return;

    const intent = resolveComposerIntent(text);
    draftRef.current = "";
    setDraft("");

    if (intent.kind === "interrupt") {
      void interrupt();
      return;
    }
    if (intent.kind === "help") {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `help:${crypto.randomUUID()}`,
          "Commands",
          "/stop (/interrupt, /esc) stops the active turn. /help (/?, /commands) shows this message. Unsupported slash commands are never sent to the model.",
        ),
      );
      return;
    }
    if (intent.kind === "local-shell-unavailable") {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `shell-unavailable:${crypto.randomUUID()}`,
          "Local shell unavailable",
          "Octoscode's ! command runs on the TUI host. A browser cannot execute a local process, so nothing was sent.",
          "error",
        ),
      );
      return;
    }
    if (intent.kind === "unsupported-command") {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `unsupported-command:${crypto.randomUUID()}`,
          `/${intent.command} is unavailable`,
          "This Web build cannot execute that Octoscode command. Nothing was sent to the model.",
          "error",
        ),
      );
      return;
    }

    const turn: PromptTurn = {
      turnId: crypto.randomUUID(),
      text: intent.text,
    };
    const { startNow } = queueRef.current.enqueue(turn);
    syncQueue();
    if (startNow) void startTurn(turn);
  };

  async function startTurn(turn: PromptTurn) {
    const client = clientRef.current;
    const sessionId = sessionIdRef.current;
    if (!client || !sessionId) return;

    setTimeline((current) =>
      addOptimisticUser(current, turn.turnId, turn.text),
    );

    try {
      await client.startTurn({
        session_id: sessionId,
        turn_id: turn.turnId,
        input: [{ kind: "text", text: turn.text }],
      });
    } catch (reason) {
      if (clientRef.current !== client) return;
      const message = reason instanceof Error ? reason.message : String(reason);
      setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turn.turnId}`,
          "Turn rejected",
          message,
          "error",
        ),
      );
      settleTurn(turn.turnId);
    }
  }

  const interrupt = async () => {
    const client = clientRef.current;
    const activeTurn = queueRef.current.snapshot().active;
    if (!client || !activeTurn) {
      setTimeline((current) =>
        addSystemMessage(
          current,
          `nothing-to-stop:${crypto.randomUUID()}`,
          "Nothing to stop",
          "There is no active foreground turn, so no server command was sent.",
        ),
      );
      return;
    }
    if (interruptingTurnIdRef.current === activeTurn.turnId) return;

    interruptingTurnIdRef.current = activeTurn.turnId;
    setInterruptingTurnId(activeTurn.turnId);
    try {
      await client.interruptTurn(sessionIdRef.current, activeTurn.turnId);
    } catch (reason) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
      setConnectionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    }
  };

  function handleNotification(notification: RpcNotification) {
    setEvents((current) =>
      [
        ...current,
        {
          id: eventId.current++,
          at: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          }),
          notification,
        },
      ].slice(-100),
    );
    setTimeline((current) => foldNotification(current, notification));
    const terminal = terminalTurnId(notification);
    if (terminal) settleTurn(terminal);
  }

  function settleTurn(turnId: string) {
    const transition = queueRef.current.settle(turnId);
    if (!transition.settled) return;

    if (interruptingTurnIdRef.current === turnId) {
      interruptingTurnIdRef.current = null;
      setInterruptingTurnId(null);
    }
    syncQueue();
    if (transition.next) void startTurn(transition.next);
  }

  function insertComposerNewline(target: HTMLTextAreaElement) {
    const value = draftRef.current;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${value.slice(0, start)}\n${value.slice(end)}`;
    draftRef.current = next;
    setDraft(next);
    requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
  }

  const features = opened?.capabilities?.supported_features ?? [];
  const connected = status === "connected" && opened !== null;
  const activeTurnId = queue.active?.turnId ?? null;

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="https://github.com/octos-org/octoscode-web">
          <span className="brand-mark">O</span>
          <span>
            <strong>octoscode</strong>
            <small>web</small>
          </span>
        </a>
        <div className="workspace-title">
          <span>{opened?.workspace_root ?? "No workspace connected"}</span>
          <small>{opened?.session_id ?? "Octos AppUI client"}</small>
        </div>
        <a
          className="repo-link"
          href="https://github.com/octos-org/octoscode-web"
        >
          GitHub ↗
        </a>
      </header>

      <main className="workspace-grid">
        <aside className="sidebar">
          <ConnectionPanel
            value={connection}
            status={status}
            error={connectionError}
            onChange={setConnection}
            onConnect={() => void connect()}
            onDisconnect={disconnect}
          />
          <section className="boundary-note">
            <span className="eyebrow">Boundary</span>
            <h3>One runtime, two clients</h3>
            <p>
              Octoscode TUI and this Web app are siblings over the same server
              protocol.
            </p>
          </section>
        </aside>

        <section className="conversation">
          <div className="conversation-scroll">
            <Timeline entries={timeline} connected={connected} />
          </div>
          <div className="composer-wrap">
            <div className="composer">
              {queue.pending.length > 0 ? (
                <div className="prompt-queue" aria-live="polite">
                  <strong>{queue.pending.length} queued</strong>
                  <span>{queue.pending[0]?.text}</span>
                </div>
              ) : null}
              <textarea
                value={draft}
                onChange={(event) => {
                  draftRef.current = event.target.value;
                  setDraft(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (
                    (event.key === "Enter" && event.altKey) ||
                    (event.key.toLowerCase() === "j" && event.ctrlKey)
                  ) {
                    event.preventDefault();
                    insertComposerNewline(event.currentTarget);
                  } else if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.ctrlKey &&
                    !event.metaKey
                  ) {
                    event.preventDefault();
                    submit();
                  }
                }}
                placeholder={
                  connected
                    ? "Ask Octos to change, explain, or review code…"
                    : "Connect a workspace to begin"
                }
                disabled={!connected}
                rows={3}
              />
              <div className="composer-footer">
                <span>
                  {connected
                    ? activeTurnId
                      ? `Working · Enter queues next${queue.pending.length ? ` · ${queue.pending.length} queued` : ""}`
                      : "Enter to send · Shift+Enter for newline"
                    : "Waiting for server"}
                </span>
                <div className="composer-actions">
                  {activeTurnId ? (
                    <button
                      className="stop-button"
                      type="button"
                      onClick={() => void interrupt()}
                      disabled={interruptingTurnId === activeTurnId}
                    >
                      {interruptingTurnId === activeTurnId
                        ? "Stopping…"
                        : "Stop"}
                    </button>
                  ) : null}
                  <button
                    className="send-button"
                    type="button"
                    onClick={submit}
                    disabled={!connected || !draft.trim()}
                  >
                    {activeTurnId ? "Queue ↑" : "Send ↑"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <EventInspector events={events} features={features} />
      </main>
    </div>
  );
}
