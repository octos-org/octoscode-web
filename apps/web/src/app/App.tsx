import { useRef, useState } from "react";
import { addSystemMessage } from "../features/timeline/model.ts";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
import { EventInspector } from "../features/inspector/EventInspector.tsx";
import { Timeline } from "../features/timeline/Timeline.tsx";
import { resolveComposerIntent } from "../features/composer/intent.ts";
import { CommandPalette } from "../features/commands/CommandPalette.tsx";
import {
  commandSuggestions,
  type WebCommandSpec,
} from "../features/commands/registry.ts";
import { ApprovalPanel } from "../features/approval/ApprovalPanel.tsx";
import { UserQuestionPanel } from "../features/questions/UserQuestionPanel.tsx";
import { useOctosSession } from "../features/session/use-octos-session.ts";
import { PermissionPanel } from "../features/permissions/PermissionPanel.tsx";
import { DiffReviewDialog } from "../features/review/DiffReviewDialog.tsx";

const initialConnection: ConnectionDraft = {
  endpoint: "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

export function App() {
  const session = useOctosSession();
  const draftRef = useRef("");
  const [connection, setConnection] = useState(initialConnection);
  const [draft, setDraft] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  const submit = (override?: string) => {
    const text = (override ?? draftRef.current).trim();
    if (!session.connected || !session.opened || !text) return;

    const intent = resolveComposerIntent(text, session.opened.capabilities);
    if (intent.kind === "empty-command") return;

    draftRef.current = "";
    setDraft("");
    setSelectedCommandIndex(0);

    if (intent.kind === "interrupt") {
      void session.interrupt();
      return;
    }
    if (intent.kind === "help") {
      const available = commandSuggestions("/", session.opened.capabilities)
        .map(
          (command) =>
            `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
        )
        .join(" · ");
      session.setTimeline((current) =>
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
      session.setTimeline((current) =>
        addSystemMessage(
          current,
          `process-status:${crypto.randomUUID()}`,
          "Process status",
          session.queue.active
            ? `Foreground turn ${session.queue.active.turnId.slice(0, 8)} is active. ${session.queue.pending.length} prompt${session.queue.pending.length === 1 ? "" : "s"} queued.`
            : "No foreground turn is active and the prompt queue is empty.",
        ),
      );
      return;
    }
    if (intent.kind === "status") {
      const capabilities = session.opened.capabilities;
      session.setTimeline((current) =>
        addSystemMessage(
          current,
          `status:${crypto.randomUUID()}`,
          "Session status",
          [
            `Session: ${session.opened?.session_id}`,
            `Workspace: ${session.opened?.workspace_root ?? "server default"}`,
            `Methods: ${capabilities?.supported_methods.length ?? 0}`,
            `Features: ${capabilities?.supported_features?.length ?? 0}`,
          ].join("\n"),
        ),
      );
      return;
    }
    if (intent.kind === "copy") {
      const lastReply = session.timeline.findLast(
        (entry) => entry.kind === "assistant" && entry.body,
      );
      if (!lastReply) {
        session.setTimeline((current) =>
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
          session.setTimeline((current) =>
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
          session.setTimeline((current) =>
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
      session.setTimeline((current) =>
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
      session.setTimeline((current) =>
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

    session.enqueuePrompt(intent.text);
  };

  function insertComposerNewline(target: HTMLTextAreaElement) {
    const value = draftRef.current;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    const next = `${value.slice(0, start)}\n${value.slice(end)}`;
    draftRef.current = next;
    setDraft(next);
    requestAnimationFrame(() => target.setSelectionRange(start + 1, start + 1));
  }

  const features = session.opened?.capabilities?.supported_features ?? [];
  const activeTurnId = session.queue.active?.turnId ?? null;
  const suggestedCommands = commandSuggestions(
    draft,
    session.opened?.capabilities,
  );
  const chooseCommand = (command: WebCommandSpec) => submit(`/${command.name}`);

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
            status={session.status}
            error={session.connectionError}
            onChange={setConnection}
            onConnect={() => session.connect(connection)}
            onDisconnect={session.disconnect}
          />
          <PermissionPanel
            state={session.permission}
            connected={Boolean(session.opened)}
            onRefresh={() => void session.refreshPermission()}
            onUpdate={(update) => void session.updatePermission(update)}
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
              <span>
                {session.opened?.workspace_root ?? "No workspace connected"}
              </span>
              <small>
                {session.opened?.session_id ?? "Octos AppUI client"}
              </small>
            </div>
            <div className="header-actions">
              {session.diffReview.available &&
              session.diffReview.latestPreviewId ? (
                <button
                  className="review-chip"
                  type="button"
                  onClick={() => void session.openDiffReview()}
                >
                  Review changes
                </button>
              ) : null}
              {session.opened ? (
                <span
                  className={`recovery-pill recovery-${session.recovery.phase}`}
                  title={
                    session.recovery.detail ?? "Durable session is synchronized"
                  }
                >
                  <span />
                  {session.recovery.phase === "healthy"
                    ? `Synced · ${session.recovery.cursor?.seq ?? "—"}`
                    : session.recovery.phase}
                </span>
              ) : null}
              <a
                className="repo-link"
                href="https://github.com/octos-org/octoscode-web"
              >
                Source ↗
              </a>
            </div>
          </header>
          <div className="conversation-scroll">
            <Timeline
              entries={session.timeline}
              connected={session.connected}
            />
          </div>
          <div className="composer-wrap">
            {session.opened && session.recovery.phase !== "healthy" ? (
              <div
                className={`recovery-banner recovery-${session.recovery.phase}`}
                role="status"
              >
                <span className="recovery-banner-mark">↻</span>
                <span>
                  <strong>
                    {session.recovery.phase === "reconnecting"
                      ? "Reconnecting to Octos"
                      : session.recovery.phase === "hydrating"
                        ? "Restoring session state"
                        : "Session recovery required"}
                  </strong>
                  <small>
                    {session.recovery.detail ??
                      "Prompts are paused until the durable projection is synchronized."}
                  </small>
                </span>
              </div>
            ) : session.approval ? (
              <ApprovalPanel
                approval={session.approval}
                busy={session.decisionBusy}
                error={session.decisionError}
                onDecide={(decision, scope) =>
                  void session.respondApproval(decision, scope)
                }
                onInterrupt={() => void session.interrupt()}
                onReviewDiff={(previewId) =>
                  void session.openDiffReview(previewId)
                }
              />
            ) : session.question ? (
              <UserQuestionPanel
                key={session.question.questionId}
                request={session.question}
                busy={session.decisionBusy}
                error={session.decisionError}
                onSubmit={(answers) => void session.respondQuestion(answers)}
                onInterrupt={() => void session.interrupt()}
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
                {session.queue.pending.length > 0 ? (
                  <div className="prompt-queue" aria-live="polite">
                    <strong>{session.queue.pending.length} queued</strong>
                    <span>{session.queue.pending[0]?.text}</span>
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
                    session.connected
                      ? "Ask Octos to change, explain, or review code…"
                      : "Connect a workspace to begin"
                  }
                  disabled={!session.connected}
                  rows={3}
                />
                <div className="composer-footer">
                  <span>
                    {session.connected
                      ? activeTurnId
                        ? `Working · Enter queues next${session.queue.pending.length ? ` · ${session.queue.pending.length} queued` : ""}`
                        : "Enter to send · Shift+Enter for newline"
                      : "Waiting for server"}
                  </span>
                  <div className="composer-actions">
                    {activeTurnId ? (
                      <button
                        className="stop-button"
                        type="button"
                        onClick={() => void session.interrupt()}
                        disabled={session.interruptingTurnId === activeTurnId}
                      >
                        {session.interruptingTurnId === activeTurnId
                          ? "Stopping…"
                          : "Stop"}
                      </button>
                    ) : null}
                    <button
                      className="send-button"
                      type="button"
                      onClick={() => submit()}
                      disabled={!session.connected || !draft.trim()}
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

        <EventInspector events={session.events} features={features} />
      </main>
      <DiffReviewDialog
        state={session.diffReview}
        onClose={session.closeDiffReview}
        onRefresh={() => void session.openDiffReview()}
      />
    </div>
  );
}
