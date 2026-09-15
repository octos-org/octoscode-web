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
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { SkeletonRows } from "../../ui/Skeleton.tsx";
import { ArrowLeftIcon, FolderIcon, PlusIcon } from "../../ui/Icon.tsx";
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
  cancelLabel?: string;
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

interface PickerBodyProps extends NewSessionWorkspacePickerProps {
  titleId: string;
  descriptionId: string;
  view: WorkspacePickerView;
  serverPath: string;
  validationError: string | null;
  cancelRef: React.RefObject<HTMLButtonElement | null>;
  pathRef: React.RefObject<HTMLInputElement | null>;
  firstWorkspaceRef: React.RefObject<HTMLButtonElement | null>;
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
  cancelLabel = "Cancel",
  serverPath,
  validationError,
  cancelRef,
  pathRef,
  firstWorkspaceRef,
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
        {view === "add" && hasWorkspaces ? (
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
        <span className={styles.sessionMark} aria-hidden="true">
          <OctopusLogo size={32} />
        </span>
        <div className={styles.heading}>
          <div className={styles.eyebrow}>New Session</div>
          <h2 id={titleId} className={styles.title}>
            {view === "choose" ? "Choose a workspace" : "Add workspace"}
          </h2>
          <p id={descriptionId} className={styles.description}>
            {view === "choose"
              ? "Choose where this coding session will run."
              : "Choose a project folder to start your coding session."}
          </p>
        </div>
      </header>

      {view === "choose" ? (
        <div className={styles.body}>
          {loading && !hasWorkspaces ? (
            <div className={styles.state} role="status" aria-live="polite">
              <SkeletonRows rows={3} />
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
              {workspaces.map((workspace, index) => {
                const selected = workspace.id === selectedWorkspaceId;
                const recent = workspace.id === recentWorkspaceId;
                const request = workspaceCreateRequest(workspace.path);
                return (
                  <li key={workspace.id}>
                    <button
                      ref={index === 0 ? firstWorkspaceRef : undefined}
                      type="button"
                      className={`${styles.workspace} ${selected ? styles.selected : ""}`}
                      aria-label={`Start a new session in ${workspace.name}`}
                      aria-describedby={`${titleId}-workspace-${index}`}
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
                        <span
                          id={`${titleId}-workspace-${index}`}
                          className={styles.workspacePath}
                          title={workspace.path}
                        >
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
                <OctopusLogo size={22} />
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
          {creating ? (
            <p className={styles.refreshing} role="status">
              Starting your session…
            </p>
          ) : null}
        </div>
      ) : (
        <form
          className={styles.body}
          onSubmit={onServerPathSubmit}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing)
              event.preventDefault();
          }}
        >
          <label
            className={styles.fieldLabel}
            htmlFor={`${titleId}-server-path`}
          >
            Server workspace path
          </label>
          <input
            ref={pathRef}
            id={`${titleId}-server-path`}
            className={styles.pathInput}
            type="text"
            value={serverPath}
            placeholder="/srv/projects/octoscode"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            disabled={creating}
            aria-invalid={validationError ? "true" : undefined}
            aria-describedby={`${titleId}-path-help${validationError ? ` ${titleId}-path-error` : ""}`}
            onChange={(event) => onServerPathChange(event.target.value)}
          />
          <p id={`${titleId}-path-help`} className={styles.pathHelp}>
            Enter a path on the Octos server, for example
            /home/you/projects/my-app.
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
              {onRetry ? (
                <button
                  type="button"
                  className={styles.retry}
                  onClick={onRetry}
                  disabled={creating}
                >
                  Retry
                </button>
              ) : null}
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
              {cancelLabel}
            </button>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={creating || !serverPath.trim()}
            >
              {creating ? "Starting…" : "Start session"}
            </button>
          </div>
        </form>
      )}

      {view === "choose" ? (
        <footer className={styles.footer}>
          <button
            ref={!hasWorkspaces ? firstWorkspaceRef : undefined}
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
            {cancelLabel}
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
  const pathRef = useRef<HTMLInputElement>(null);
  const firstWorkspaceRef = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<WorkspacePickerView>(initialView);
  const [serverPath, setServerPath] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  // A fresh browser has no paths to choose from. Open the useful step directly.
  const activeView =
    view === "choose" && !props.workspaces.length && !props.loading
      ? "add"
      : view;

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setServerPath("");
    setValidationError(null);
  }, [initialView, open]);

  useEffect(() => {
    if (!open || activeView !== "add") return;
    const frame = requestAnimationFrame(() => pathRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, activeView]);

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
    if (props.creating) return;
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
      view={activeView}
      serverPath={serverPath}
      validationError={validationError}
      cancelRef={cancelRef}
      pathRef={pathRef}
      firstWorkspaceRef={firstWorkspaceRef}
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
        aria-busy={props.creating || undefined}
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
      initialFocusRef={activeView === "add" ? pathRef : firstWorkspaceRef}
      closeOnBackdrop={!props.creating}
      onEscape={() => {
        if (!props.creating) props.onCancel();
      }}
    >
      {body}
    </ModalSurface>
  );
}
