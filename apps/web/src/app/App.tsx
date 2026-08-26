import { useEffect, useRef, useState } from "react";
import { addSystemMessage } from "../features/timeline/model.ts";
import {
  ConnectionPanel,
  type ConnectionDraft,
} from "../features/connection/ConnectionPanel.tsx";
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
import { WorkInspector } from "../features/supervision/WorkInspector.tsx";
import { TaskDetailDialog } from "../features/supervision/TaskDetailDialog.tsx";
import { SessionNavigator } from "../features/workspace/SessionNavigator.tsx";
import { LaunchDecisionPanel } from "../features/workspace/LaunchDecisionPanel.tsx";
import { ActivityNavigator } from "../features/activity/ActivityNavigator.tsx";
import { SessionDraftCache } from "../features/session/session-draft-cache.ts";

const initialConnection: ConnectionDraft = {
  endpoint:
    import.meta.env.VITE_OCTOS_DEFAULT_ENDPOINT ?? "http://127.0.0.1:50080",
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};
const COMMAND_PALETTE_ID = "composer-command-palette";

export function App() {
  const {
    connection: session,
    conversation,
    interactions,
    safety,
    work,
    workspaceProduct,
    diagnostics,
  } = useOctosSession();
  const draftRef = useRef("");
  const sessionDraftsRef = useRef(new SessionDraftCache());
  const [connection, setConnection] = useState(initialConnection);
  const [draft, setDraft] = useState("");
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
  const [commandPaletteDismissed, setCommandPaletteDismissed] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);

  useEffect(() => {
    if (!inspectorOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInspectorOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [inspectorOpen]);

  const submit = (override?: string) => {
    const text = (override ?? draftRef.current).trim();
    const opened = session.opened;
    if (!session.connected || !opened || !text) return;

    const intent = resolveComposerIntent(text, opened.capabilities);
    if (intent.kind === "empty-command") return;

    draftRef.current = "";
    setDraft("");
    setSelectedCommandIndex(0);
    setCommandPaletteDismissed(false);

    switch (intent.kind) {
      case "prompt":
        conversation.enqueuePrompt(intent.text);
        return;
      case "interrupt":
        void conversation.interrupt();
        return;
      case "help": {
        const available = commandSuggestions("/", opened.capabilities)
          .map(
            (command) =>
              `/${command.name}${command.aliases.length ? ` (${command.aliases.map((alias) => `/${alias}`).join(", ")})` : ""}`,
          )
          .join(" · ");
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `help:${crypto.randomUUID()}`,
            "Commands",
            `${available}. Unsupported slash commands are never sent to the model.`,
          ),
        );
        return;
      }
      case "process-status":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `process-status:${crypto.randomUUID()}`,
            "Process status",
            conversation.queue.active
              ? `Foreground turn ${conversation.queue.active.turnId.slice(0, 8)} is active. ${conversation.queue.pending.length} prompt${conversation.queue.pending.length === 1 ? "" : "s"} queued.`
              : "No foreground turn is active and the prompt queue is empty.",
          ),
        );
        return;
      case "activity":
        setActivityOpen(true);
        return;
      case "status": {
        const capabilities = opened.capabilities;
        conversation.setTimeline((current) =>
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
      case "copy": {
        const lastReply = conversation.timeline.findLast(
          (entry) => entry.kind === "assistant" && entry.body,
        );
        if (!lastReply) {
          conversation.setTimeline((current) =>
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
            conversation.setTimeline((current) =>
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
            conversation.setTimeline((current) =>
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
      case "local-shell-unavailable":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `shell-unavailable:${crypto.randomUUID()}`,
            "Local shell unavailable",
            "Octoscode's ! command runs on the TUI host. A browser cannot execute a local process, so nothing was sent.",
            "error",
          ),
        );
        return;
      case "unsupported-command":
        conversation.setTimeline((current) =>
          addSystemMessage(
            current,
            `unsupported-command:${crypto.randomUUID()}`,
            `/${intent.command} is unavailable`,
            "This Web build cannot execute that Octoscode command. Nothing was sent to the model.",
            "error",
          ),
        );
        return;
      default:
        return assertNever(intent);
    }
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
  const activeTurnId = conversation.queue.active?.turnId ?? null;
  const suggestedCommands = commandPaletteDismissed
    ? []
    : commandSuggestions(draft, session.opened?.capabilities);
  const chooseCommand = (command: WebCommandSpec) => submit(`/${command.name}`);
  const switchBlocked = Boolean(
    conversation.queue.active || conversation.queue.pending.length,
  );
  const moveToSession = (sessionId: string) => {
    if (switchBlocked || sessionId === session.opened?.session_id) return;
    if (session.opened?.session_id) {
      sessionDraftsRef.current.set(session.opened.session_id, draftRef.current);
    }
    const restored = sessionDraftsRef.current.get(sessionId) ?? "";
    draftRef.current = restored;
    setDraft(restored);
    setConnection((current) => ({ ...current, sessionId }));
    workspaceProduct.switchSession(sessionId);
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
            status={session.status}
            error={session.error}
            onChange={setConnection}
            onConnect={() => session.connect(connection)}
            onDisconnect={session.disconnect}
          />
          {session.opened ? (
            <SessionNavigator
              state={workspaceProduct.state}
              activeSessionId={session.opened.session_id}
              switchBlocked={switchBlocked}
              onRefresh={() => void workspaceProduct.refresh()}
              onSwitch={moveToSession}
              onCreate={moveToSession}
              onDelete={(sessionId) =>
                void workspaceProduct.deleteSession(sessionId)
              }
            />
          ) : null}
          <PermissionPanel
            state={safety.permission}
            connected={Boolean(session.opened)}
            onRefresh={() => void safety.refreshPermission()}
            onUpdate={(update) => void safety.updatePermission(update)}
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
                {session.opened?.workspace_root ??
                  workspaceProduct.launch.cwd ??
                  "No workspace connected"}
              </span>
              <small>
                {session.opened?.session_id ??
                  (workspaceProduct.launch.phase === "resolving"
                    ? "Resolving workspace launch"
                    : "Octos AppUI client")}
              </small>
            </div>
            <div className="header-actions">
              {session.opened && workspaceProduct.state.activityAvailable ? (
                <button
                  className="activity-toggle"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={activityOpen}
                  onClick={() => setActivityOpen(true)}
                >
                  Activity
                  {workspaceProduct.state.activityLoading ? (
                    <span aria-label="refreshing" />
                  ) : null}
                </button>
              ) : null}
              <button
                className="inspector-toggle"
                type="button"
                aria-controls="work-inspector"
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen(true)}
              >
                Work
              </button>
              {safety.diffReview.available &&
              safety.diffReview.latestPreviewId ? (
                <button
                  className="review-chip"
                  type="button"
                  onClick={() => void safety.openDiffReview()}
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
          <div
            className="conversation-scroll"
            role="region"
            aria-label="Conversation"
            tabIndex={0}
          >
            {workspaceProduct.launch.decision ? (
              <LaunchDecisionPanel
                state={workspaceProduct.launch}
                onboarding={workspaceProduct.onboarding}
                onSubmitOnboarding={(submission) =>
                  void workspaceProduct.submitOnboarding(submission)
                }
                onRetryOnboarding={() =>
                  void workspaceProduct.retryOnboarding()
                }
                onChooseProfile={(profileId) =>
                  void workspaceProduct.chooseLaunchProfile(profileId)
                }
                onCancel={session.disconnect}
              />
            ) : (
              <Timeline
                entries={conversation.timeline}
                connected={session.connected}
              />
            )}
          </div>
          <div
            className={`composer-wrap${workspaceProduct.launch.decision ? " is-hidden" : ""}`}
          >
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
            ) : interactions.approval ? (
              <ApprovalPanel
                approval={interactions.approval}
                busy={interactions.busy}
                error={interactions.error}
                onDecide={(decision, scope) =>
                  void interactions.respondApproval(decision, scope)
                }
                onInterrupt={() => void conversation.interrupt()}
                onReviewDiff={(previewId) =>
                  void safety.openDiffReview(previewId)
                }
              />
            ) : interactions.question ? (
              <UserQuestionPanel
                key={interactions.question.questionId}
                request={interactions.question}
                busy={interactions.busy}
                error={interactions.error}
                onSubmit={(answers) =>
                  void interactions.respondQuestion(answers)
                }
                onInterrupt={() => void conversation.interrupt()}
              />
            ) : (
              <div className="composer">
                <CommandPalette
                  id={COMMAND_PALETTE_ID}
                  commands={suggestedCommands}
                  selectedIndex={Math.min(
                    selectedCommandIndex,
                    Math.max(0, suggestedCommands.length - 1),
                  )}
                  onSelect={chooseCommand}
                />
                {conversation.queue.pending.length > 0 ? (
                  <div className="prompt-queue" aria-live="polite">
                    <strong>{conversation.queue.pending.length} queued</strong>
                    <span>{conversation.queue.pending[0]?.text}</span>
                  </div>
                ) : null}
                <textarea
                  value={draft}
                  onChange={(event) => {
                    draftRef.current = event.target.value;
                    setDraft(event.target.value);
                    setSelectedCommandIndex(0);
                    setCommandPaletteDismissed(false);
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
                      setCommandPaletteDismissed(true);
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
                  role="combobox"
                  aria-autocomplete="list"
                  aria-haspopup="listbox"
                  aria-expanded={suggestedCommands.length > 0}
                  aria-controls={COMMAND_PALETTE_ID}
                  aria-activedescendant={
                    suggestedCommands[selectedCommandIndex]
                      ? `${COMMAND_PALETTE_ID}-${suggestedCommands[selectedCommandIndex].name}`
                      : undefined
                  }
                  rows={3}
                />
                <div className="composer-footer">
                  <span>
                    {session.connected
                      ? activeTurnId
                        ? `Working · Enter queues next${conversation.queue.pending.length ? ` · ${conversation.queue.pending.length} queued` : ""}`
                        : "Enter to send · Shift+Enter for newline"
                      : "Waiting for server"}
                  </span>
                  <div className="composer-actions">
                    {activeTurnId ? (
                      <button
                        className="stop-button"
                        type="button"
                        onClick={() => void conversation.interrupt()}
                        disabled={
                          conversation.interruptingTurnId === activeTurnId
                        }
                      >
                        {conversation.interruptingTurnId === activeTurnId
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

        <WorkInspector
          open={inspectorOpen}
          state={work.supervision}
          events={diagnostics.events}
          omittedEvents={diagnostics.omittedEvents}
          features={features}
          onRefresh={() => void work.refresh()}
          onOpenTask={(taskId) => void work.openTask(taskId)}
          onCancelTask={(taskId) => void work.cancelTask(taskId)}
          tokenCost={workspaceProduct.state.tokenCost}
          onClose={() => setInspectorOpen(false)}
        />
        {inspectorOpen ? (
          <button
            className="inspector-backdrop"
            type="button"
            aria-label="Close work inspector"
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
      </main>
      <DiffReviewDialog
        state={safety.diffReview}
        onClose={safety.closeDiffReview}
        onRefresh={() => void safety.openDiffReview()}
      />
      <TaskDetailDialog
        state={work.supervision}
        onClose={work.closeTask}
        onLoadMore={() => void work.loadMoreOutput()}
        onReadArtifact={(artifact) => void work.readArtifact(artifact)}
        onLoadMoreArtifact={() => void work.loadMoreArtifact()}
      />
      <ActivityNavigator
        open={activityOpen}
        state={workspaceProduct.state}
        activeSessionId={session.opened?.session_id ?? null}
        switchBlocked={switchBlocked}
        onClose={() => setActivityOpen(false)}
        onOpenSession={moveToSession}
        onInspectCurrentTask={(taskId) => void work.openTask(taskId)}
      />
    </div>
  );
}

function assertNever(value: never): never {
  throw new Error(`Unhandled composer intent: ${JSON.stringify(value)}`);
}
