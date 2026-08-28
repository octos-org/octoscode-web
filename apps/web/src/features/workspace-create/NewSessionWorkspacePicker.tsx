/**
 * New-session Workspace choice adapted from DeepSeek Harness' WorkspacePicker.
 * Source revision: b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
 * Copyright (c) 2026 DeepSeek. Licensed under the MIT License.
 * See ../../../../../THIRD_PARTY_NOTICES.md.
 *
 * The Octos adapter supplies tab-scoped recent server paths and performs
 * creation. These hints are never presented as a Core-owned Workspace catalog.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ModalSurface } from "../../ui/ModalSurface.tsx";
import styles from "./NewSessionWorkspacePicker.module.css";

export interface RecentWorkspacePath {
  id: string;
  name: string;
  path: string;
}

export interface WorkspaceCreateRequest {
  workspacePath: string;
}

export type WorkspacePickerPresentation = "dialog" | "hero";
export type WorkspacePickerView = "choose" | "add";

export interface NewSessionWorkspacePickerProps {
  open?: boolean;
  presentation?: WorkspacePickerPresentation;
  initialView?: WorkspacePickerView;
  workspaces: readonly RecentWorkspacePath[];
  selectedWorkspaceId?: string;
  recentWorkspaceId?: string;
  loading?: boolean;
  error?: string | null;
  creating?: boolean;
  onRetry?: () => void;
  onCancel: () => void;
  onCreate: (request: WorkspaceCreateRequest) => void;
}

/** Normalize a host path before it crosses the presentation/adapter boundary. */
export function workspaceCreateRequest(
  serverPath: string,
): WorkspaceCreateRequest | null {
  const workspacePath = serverPath.trim();
  return workspacePath ? { workspacePath } : null;
}

function FolderIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2.25 4.5c0-.69.56-1.25 1.25-1.25h3.13l1.25 1.5h6.62c.69 0 1.25.56 1.25 1.25v7.25c0 .69-.56 1.25-1.25 1.25h-11c-.69 0-1.25-.56-1.25-1.25V4.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 15 15"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m8.75 3.25-4.25 4.25 4.25 4.25M4.75 7.5h6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface PickerBodyProps extends NewSessionWorkspacePickerProps {
  titleId: string;
  descriptionId: string;
  view: WorkspacePickerView;
  serverPath: string;
  validationError: string | null;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  onViewChange: (view: WorkspacePickerView) => void;
  onServerPathChange: (path: string) => void;
  onServerPathSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function PickerBody({
  titleId,
  descriptionId,
  view,
  workspaces,
  selectedWorkspaceId,
  recentWorkspaceId,
  loading = false,
  error = null,
  creating = false,
  serverPath,
  validationError,
  cancelRef,
  onRetry,
  onCancel,
  onCreate,
  onViewChange,
  onServerPathChange,
  onServerPathSubmit,
}: PickerBodyProps) {
  const hasWorkspaces = workspaces.length > 0;

  return (
    <>
      <header className={styles.header}>
        {view === "add" ? (
          <button
            type="button"
            className={styles.back}
            aria-label="Back to workspaces"
            disabled={creating}
            onClick={() => onViewChange("choose")}
          >
            <ArrowLeftIcon />
          </button>
        ) : null}
        <div className={styles.heading}>
          <div className={styles.eyebrow}>New Session</div>
          <h2 id={titleId} className={styles.title}>
            {view === "choose" ? "Choose a workspace" : "Add workspace"}
          </h2>
          <p id={descriptionId} className={styles.description}>
            {view === "choose"
              ? "Choose where this coding session will run."
              : "Use a path on the server running Octos."}
          </p>
        </div>
      </header>

      {view === "choose" ? (
        <div className={styles.body}>
          {loading && !hasWorkspaces ? (
            <div className={styles.state} role="status" aria-live="polite">
              <span className={styles.spinner} aria-hidden="true" />
              <span>Loading recent workspace paths…</span>
            </div>
          ) : null}

          {error ? (
            <div
              className={`${styles.state} ${styles.errorState}`}
              role="alert"
            >
              <span>{error}</span>
              {onRetry ? (
                <button
                  type="button"
                  className={styles.retry}
                  onClick={onRetry}
                >
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {hasWorkspaces ? (
            <ul
              className={styles.workspaceList}
              aria-label="Recent workspace paths"
            >
              {workspaces.map((workspace) => {
                const selected = workspace.id === selectedWorkspaceId;
                const recent = workspace.id === recentWorkspaceId;
                const request = workspaceCreateRequest(workspace.path);
                return (
                  <li key={workspace.id}>
                    <button
                      type="button"
                      className={`${styles.workspace} ${selected ? styles.selected : ""}`}
                      aria-label={`Start a new session in ${workspace.name}`}
                      aria-current={selected ? "true" : undefined}
                      disabled={creating || request === null}
                      onClick={() => {
                        if (request) onCreate(request);
                      }}
                    >
                      <span className={styles.folder} aria-hidden="true">
                        <FolderIcon />
                      </span>
                      <span className={styles.workspaceText}>
                        <span className={styles.workspaceName}>
                          {workspace.name}
                        </span>
                        <span className={styles.workspacePath}>
                          {workspace.path}
                        </span>
                      </span>
                      <span className={styles.badges} aria-hidden="true">
                        {selected ? (
                          <span className={styles.badge}>Current</span>
                        ) : null}
                        {recent ? (
                          <span className={styles.badge}>Recent</span>
                        ) : null}
                      </span>
                      <span className={styles.rowAction} aria-hidden="true">
                        Start
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : !loading && !error ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <FolderIcon />
              </span>
              <strong>No recent workspace paths</strong>
              <span>Enter a path on the Octos server to start a session.</span>
            </div>
          ) : null}

          {loading && hasWorkspaces ? (
            <div className={styles.refreshing} role="status" aria-live="polite">
              Refreshing recent paths…
            </div>
          ) : null}
        </div>
      ) : (
        <form className={styles.body} onSubmit={onServerPathSubmit}>
          <label
            className={styles.fieldLabel}
            htmlFor={`${titleId}-server-path`}
          >
            Server workspace path
          </label>
          <input
            id={`${titleId}-server-path`}
            className={styles.pathInput}
            type="text"
            value={serverPath}
            placeholder="/srv/projects/octoscode"
            autoComplete="off"
            spellCheck={false}
            disabled={creating}
            aria-invalid={validationError ? "true" : undefined}
            aria-describedby={`${titleId}-path-help${validationError ? ` ${titleId}-path-error` : ""}`}
            onChange={(event) => onServerPathChange(event.target.value)}
          />
          <p id={`${titleId}-path-help`} className={styles.pathHelp}>
            This is a path on the Octos server, not a folder in this browser.
          </p>
          {validationError ? (
            <p
              id={`${titleId}-path-error`}
              className={styles.validation}
              role="alert"
            >
              {validationError}
            </p>
          ) : null}
          {error ? (
            <div
              className={`${styles.state} ${styles.errorState}`}
              role="alert"
            >
              <span>{error}</span>
            </div>
          ) : null}
          <div className={styles.formSpacer} />
          <div className={styles.footer}>
            <button
              ref={cancelRef}
              type="button"
              className={styles.secondaryButton}
              disabled={creating}
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={creating || !serverPath.trim()}
            >
              {creating ? "Starting…" : "Add & Start"}
            </button>
          </div>
        </form>
      )}

      {view === "choose" ? (
        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.addButton}
            disabled={creating}
            onClick={() => onViewChange("add")}
          >
            <PlusIcon />
            <span>Add workspace</span>
          </button>
          <button
            ref={cancelRef}
            type="button"
            className={styles.secondaryButton}
            disabled={creating}
            onClick={onCancel}
          >
            Cancel
          </button>
        </footer>
      ) : null}
    </>
  );
}

/**
 * Controlled product entry for creating a session in a known or new Workspace.
 * Session/profile identifiers are deliberately absent from this interaction.
 */
export function NewSessionWorkspacePicker({
  open = true,
  presentation = "dialog",
  initialView = "choose",
  ...props
}: NewSessionWorkspacePickerProps) {
  const titleId = useId();
  const descriptionId = `${titleId}-description`;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<WorkspacePickerView>(initialView);
  const [serverPath, setServerPath] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setServerPath("");
    setValidationError(null);
  }, [initialView, open]);

  if (!open) return null;

  const changeView = (nextView: WorkspacePickerView) => {
    setView(nextView);
    setValidationError(null);
  };

  const changeServerPath = (path: string) => {
    setServerPath(path);
    if (validationError) setValidationError(null);
  };

  const submitServerPath = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const request = workspaceCreateRequest(serverPath);
    if (!request) {
      setValidationError("Enter a workspace path on the Octos server.");
      return;
    }
    props.onCreate(request);
  };

  const body = (
    <PickerBody
      {...props}
      open={open}
      presentation={presentation}
      initialView={initialView}
      titleId={titleId}
      descriptionId={descriptionId}
      view={view}
      serverPath={serverPath}
      validationError={validationError}
      cancelRef={cancelRef}
      onViewChange={changeView}
      onServerPathChange={changeServerPath}
      onServerPathSubmit={submitServerPath}
    />
  );

  if (presentation === "hero") {
    return (
      <section
        className={`${styles.surface} ${styles.hero}`}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        {body}
      </section>
    );
  }

  return (
    <ModalSurface
      backdropClassName={styles.overlay ?? ""}
      dialogClassName={styles.surface ?? ""}
      labelledBy={titleId}
      describedBy={descriptionId}
      initialFocusRef={cancelRef}
      closeOnBackdrop
      onEscape={props.onCancel}
    >
      {body}
    </ModalSurface>
  );
}
