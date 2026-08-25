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
  const [connection, setConnection] = useState(initialConnection);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [opened, setOpened] = useState<SessionOpened | null>(null);
  const [events, setEvents] = useState<ObservedEvent[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);

  const connect = async () => {
    clientRef.current?.disconnect();
    setConnectionError(null);
    setOpened(null);
    setEvents([]);
    setTimeline([]);

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
    setActiveTurnId(null);
  };

  const submit = async () => {
    const client = clientRef.current;
    const text = draft.trim();
    if (!client || status !== "connected" || !text || submitting) return;

    const turnId = crypto.randomUUID();
    setDraft("");
    setSubmitting(true);
    setActiveTurnId(turnId);
    setTimeline((current) => addOptimisticUser(current, turnId, text));

    try {
      await client.startTurn({
        session_id: connection.sessionId.trim(),
        turn_id: turnId,
        input: [{ kind: "text", text }],
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setActiveTurnId(null);
      setTimeline((current) =>
        addSystemMessage(
          current,
          `send-error:${turnId}`,
          "Turn rejected",
          message,
          "error",
        ),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const interrupt = async () => {
    const client = clientRef.current;
    if (!client || !activeTurnId) return;
    try {
      await client.interruptTurn(connection.sessionId.trim(), activeTurnId);
    } catch (reason) {
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
    if (terminal)
      setActiveTurnId((current) => (current === terminal ? null : current));
  }

  const features = opened?.capabilities?.supported_features ?? [];
  const connected = status === "connected" && opened !== null;

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
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submit();
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
                    ? "Enter to send · Shift+Enter for newline"
                    : "Waiting for server"}
                </span>
                {activeTurnId ? (
                  <button
                    className="stop-button"
                    type="button"
                    onClick={() => void interrupt()}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="send-button"
                    type="button"
                    onClick={() => void submit()}
                    disabled={!connected || !draft.trim() || submitting}
                  >
                    Send ↑
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>

        <EventInspector events={events} features={features} />
      </main>
    </div>
  );
}
