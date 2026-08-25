import { useRef, useState } from "react";
import {
  approvalResolutionId,
  DEFAULT_UI_FEATURES,
  OctosUiClient,
  parseApprovalRequested,
  parseUserQuestionRequested,
  supportsFeature,
  supportsMethod,
  type ApprovalDecision,
  type ApprovalRequested,
  type ApprovalScope,
  type ConnectionStatus,
  type RpcNotification,
  type SessionOpened,
  type UiProtocolCapabilities,
  type UserQuestionAnswer,
  type UserQuestionRequested,
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
import { CommandPalette } from "../features/commands/CommandPalette.tsx";
import {
  commandSuggestions,
  type WebCommandSpec,
} from "../features/commands/registry.ts";
import { ApprovalPanel } from "../features/approval/ApprovalPanel.tsx";
import { UserQuestionPanel } from "../features/questions/UserQuestionPanel.tsx";

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
  const capabilitiesRef = useRef<UiProtocolCapabilities | undefined>(undefined);
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
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [approval, setApproval] = useState<ApprovalRequested | null>(null);
  const [question, setQuestion] = useState<UserQuestionRequested | null>(null);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const syncQueue = () => setQueue(queueRef.current.snapshot());

  const resetQueue = () => {
    queueRef.current.clear();
    interruptingTurnIdRef.current = null;
    setInterruptingTurnId(null);
    syncQueue();
  };

  const resetBlockingInteraction = () => {
    setApproval(null);
    setQuestion(null);
    setDecisionBusy(false);
    setDecisionError(null);
  };

  const connect = async () => {
    clientRef.current?.disconnect();
    setConnectionError(null);
    setOpened(null);
    setEvents([]);
    setTimeline([]);
    resetQueue();
    resetBlockingInteraction();
    capabilitiesRef.current = undefined;

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
      capabilitiesRef.current = result.opened.capabilities;
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
    capabilitiesRef.current = undefined;
    resetQueue();
    resetBlockingInteraction();
  };

  const submit = (override?: string) => {
    const text = (override ?? draftRef.current).trim();
    if (!clientRef.current || status !== "connected" || !opened || !text)
      return;

    const intent = resolveComposerIntent(text, opened.capabilities);
    if (intent.kind === "empty-command") return;

    draftRef.current = "";
    setDraft("");
    setSelectedCommandIndex(0);

    if (intent.kind === "interrupt") {
      void interrupt();
      return;
    }
    if (intent.kind === "help") {
      const available = commandSuggestions("/", opened.capabilities)
        .map(
          (command) =>
            `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
        )
        .join(" · ");
      setTimeline((current) =>
        addSystemMessage(
          current,
          `help:${crypto.randomUUID()}`,
          "Commands",
          `${available}. Unsupported slash commands are never sent to the model.`,
        ),
      );
      return;
    }
    if (intent.kind === "process-status") {
      const snapshot = queueRef.current.snapshot();
      setTimeline((current) =>
        addSystemMessage(
          current,
          `process-status:${crypto.randomUUID()}`,
          "Process status",
          snapshot.active
            ? `Foreground turn ${snapshot.active.turnId.slice(0, 8)} is active. ${snapshot.pending.length} prompt${snapshot.pending.length === 1 ? "" : "s"} queued.`
            : "No foreground turn is active and the prompt queue is empty.",
        ),
      );
      return;
    }
    if (intent.kind === "status") {
      const capabilities = opened.capabilities;
      setTimeline((current) =>
        addSystemMessage(
          current,
          `status:${crypto.randomUUID()}`,
          "Session status",
          [
            `Session: ${opened.session_id}`,
            `Workspace: ${opened.workspace_root ?? "server default"}`,
            `Methods: ${capabilities?.supported_methods.length ?? 0}`,
            `Features: ${capabilities?.supported_features?.length ?? 0}`,
          ].join("\n"),
        ),
      );
      return;
    }
    if (intent.kind === "copy") {
      const lastReply = timeline.findLast(
        (entry) => entry.kind === "assistant" && entry.body,
      );
      if (!lastReply) {
        setTimeline((current) =>
          addSystemMessage(
            current,
            `copy-empty:${crypto.randomUUID()}`,
            "Nothing to copy",
            "There is no assistant reply in this session yet.",
          ),
        );
        return;
      }
      void navigator.clipboard
        .writeText(lastReply.body)
        .then(() =>
          setTimeline((current) =>
            addSystemMessage(
              current,
              `copy-ok:${crypto.randomUUID()}`,
              "Copied",
              "The last assistant reply is on the clipboard.",
              "complete",
            ),
          ),
        )
        .catch((reason: unknown) =>
          setTimeline((current) =>
            addSystemMessage(
              current,
              `copy-error:${crypto.randomUUID()}`,
              "Copy failed",
              reason instanceof Error ? reason.message : String(reason),
              "error",
            ),
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

  const respondApproval = async (
    decision: ApprovalDecision,
    scope: ApprovalScope,
  ) => {
    const client = clientRef.current;
    const current = approval;
    if (!client || !current || decisionBusy) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      const result = await client.respondApproval({
        session_id: current.sessionId,
        approval_id: current.approvalId,
        decision,
        approval_scope: scope,
      });
      if (!result.accepted) throw new Error("The server rejected the decision");
      setApproval((pending) =>
        pending?.approvalId === current.approvalId ? null : pending,
      );
    } catch (reason) {
      setDecisionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setDecisionBusy(false);
    }
  };

  const respondQuestion = async (answers: UserQuestionAnswer[]) => {
    const client = clientRef.current;
    const current = question;
    if (!client || !current || decisionBusy) return;
    setDecisionBusy(true);
    setDecisionError(null);
    try {
      const result = await client.respondUserQuestion({
        session_id: current.sessionId,
        question_id: current.questionId,
        answers,
      });
      if (!result.accepted) throw new Error("The server rejected the answer");
      setQuestion((pending) =>
        pending?.questionId === current.questionId ? null : pending,
      );
    } catch (reason) {
      setDecisionError(
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      setDecisionBusy(false);
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

    if (notification.method === "approval/requested") {
      const requested = parseApprovalRequested(notification);
      if (
        requested &&
        requested.sessionId === sessionIdRef.current &&
        supportsMethod(capabilitiesRef.current, "approval/respond")
      ) {
        setDecisionError(null);
        setApproval(requested);
      } else {
        setTimeline((current) =>
          addSystemMessage(
            current,
            `invalid-approval:${crypto.randomUUID()}`,
            "Approval cannot be rendered",
            "The request was malformed, belonged to another session, or approval/respond was not negotiated.",
            "error",
          ),
        );
      }
    }
    const resolvedApprovalId = approvalResolutionId(notification);
    if (resolvedApprovalId) {
      setApproval((pending) =>
        pending?.approvalId === resolvedApprovalId ? null : pending,
      );
    }

    if (notification.method === "user_question/requested") {
      const requested = parseUserQuestionRequested(notification);
      if (
        requested &&
        requested.sessionId === sessionIdRef.current &&
        supportsMethod(capabilitiesRef.current, "user_question/respond") &&
        supportsFeature(capabilitiesRef.current, "user_question.v1")
      ) {
        setDecisionError(null);
        setQuestion(requested);
      } else {
        setTimeline((current) =>
          addSystemMessage(
            current,
            `invalid-question:${crypto.randomUUID()}`,
            "Question cannot be rendered",
            "The request was malformed, belonged to another session, or user_question.v1 was not negotiated.",
            "error",
          ),
        );
      }
    }

    const terminal = terminalTurnId(notification);
    if (terminal) {
      setApproval((pending) => (pending?.turnId === terminal ? null : pending));
      setQuestion((pending) => (pending?.turnId === terminal ? null : pending));
      settleTurn(terminal);
    }
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
  const suggestedCommands = commandSuggestions(draft, opened?.capabilities);

  const chooseCommand = (command: WebCommandSpec) => {
    submit(`/${command.name}`);
  };

  return (
    <div className="app-shell">
      <main className="workspace-grid">
        <aside className="sidebar">
          <div className="sidebar-brand">
            <a
              className="brand"
              href="https://github.com/octos-org/octoscode-web"
            >
              <span className="brand-mark">O</span>
              <span>
                <strong>octoscode</strong>
                <small>web</small>
              </span>
            </a>
          </div>
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
          <header className="conversation-header">
            <div className="workspace-title">
              <span>{opened?.workspace_root ?? "No workspace connected"}</span>
              <small>{opened?.session_id ?? "Octos AppUI client"}</small>
            </div>
            <a
              className="repo-link"
              href="https://github.com/octos-org/octoscode-web"
            >
              Source ↗
            </a>
          </header>
          <div className="conversation-scroll">
            <Timeline entries={timeline} connected={connected} />
          </div>
          <div className="composer-wrap">
            {approval ? (
              <ApprovalPanel
                approval={approval}
                busy={decisionBusy}
                error={decisionError}
                onDecide={(decision, scope) =>
                  void respondApproval(decision, scope)
                }
                onInterrupt={() => void interrupt()}
              />
            ) : question ? (
              <UserQuestionPanel
                key={question.questionId}
                request={question}
                busy={decisionBusy}
                error={decisionError}
                onSubmit={(answers) => void respondQuestion(answers)}
                onInterrupt={() => void interrupt()}
              />
            ) : (
              <div className="composer">
                <CommandPalette
                  commands={suggestedCommands}
                  selectedIndex={Math.min(
                    selectedCommandIndex,
                    Math.max(0, suggestedCommands.length - 1),
                  )}
                  onSelect={chooseCommand}
                />
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
                    setSelectedCommandIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (suggestedCommands.length && event.key === "ArrowDown") {
                      event.preventDefault();
                      setSelectedCommandIndex(
                        (current) => (current + 1) % suggestedCommands.length,
                      );
                    } else if (
                      suggestedCommands.length &&
                      event.key === "ArrowUp"
                    ) {
                      event.preventDefault();
                      setSelectedCommandIndex(
                        (current) =>
                          (current - 1 + suggestedCommands.length) %
                          suggestedCommands.length,
                      );
                    } else if (
                      suggestedCommands.length &&
                      event.key === "Escape"
                    ) {
                      event.preventDefault();
                      draftRef.current = "";
                      setDraft("");
                      setSelectedCommandIndex(0);
                    } else if (
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
                      const selected = suggestedCommands[selectedCommandIndex];
                      if (selected) chooseCommand(selected);
                      else submit();
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
                      onClick={() => submit()}
                      disabled={!connected || !draft.trim()}
                      aria-label={activeTurnId ? "Queue prompt" : "Send prompt"}
                      title={activeTurnId ? "Queue prompt" : "Send prompt"}
                    >
                      ↑
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        <EventInspector events={events} features={features} />
      </main>
    </div>
  );
}
