/**
 * Server-folder browser for the Add workspace form
 * (WEB-WORKSPACE-BROWSER-CONTRACT-5000 §Client behaviour).
 *
 * Thin: every decision it makes — where to open, what the parent is, whether a
 * name is usable, which copy a refusal earns — lives in ./workspace-browse.ts.
 * This file only wires those to the adapter and to accessible controls.
 */
import { useEffect, useReducer, useRef, type FormEvent } from "react";
import { ArrowUpIcon, FolderIcon, PlusIcon } from "../../ui/Icon.tsx";
import { SkeletonRows } from "../../ui/Skeleton.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import styles from "./NewSessionWorkspacePicker.module.css";
import {
  IDLE_WORKSPACE_BROWSE,
  WORKSPACE_BROWSE_MAX_ASCENT,
  canCreateWorkspaceFolder,
  validateWorkspaceFolderName,
  workspaceBrowseCopy,
  workspaceBrowseReducer,
  workspaceBrowseRetryPath,
  workspaceFolderNameCopy,
  workspaceListingNotices,
  type WorkspaceBrowseAdapter,
} from "./workspace-browse.ts";

export interface WorkspaceFolderBrowserProps {
  adapter: WorkspaceBrowseAdapter;
  /** Where browsing opens; null = the server's own working directory. */
  initialPath: string | null;
  /** Prefix for ids owned by the picker that hosts this browser. */
  titleId: string;
  disabled?: boolean;
  onChoose: (path: string) => void;
  onBack: () => void;
}

export function WorkspaceFolderBrowser({
  adapter,
  initialPath,
  titleId,
  disabled = false,
  onChoose,
  onBack,
}: WorkspaceFolderBrowserProps) {
  const t = useUiText();
  const [state, dispatch] = useReducer(
    workspaceBrowseReducer,
    IDLE_WORKSPACE_BROWSE,
  );
  const requestRef = useRef(0);
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const nameRef = useRef<HTMLInputElement>(null);
  const openedRef = useRef(false);

  /**
   * `resolveAncestor` implements "the typed path's nearest existing ancestor":
   * only the first open walks up, and only for refusals ascending can fix.
   */
  const load = async (path: string | null, resolveAncestor = false) => {
    const request = ++requestRef.current;
    dispatch({ type: "loading" });
    let candidate = path;
    for (let step = 0; step <= WORKSPACE_BROWSE_MAX_ASCENT; step += 1) {
      const outcome = await adapterRef.current.list(candidate);
      // A later navigation already owns the view; a stale answer never lands.
      if (requestRef.current !== request) return;
      if (outcome.status === "ok") {
        dispatch({ type: "listed", listing: outcome.value });
        return;
      }
      const next = resolveAncestor
        ? workspaceBrowseRetryPath(candidate, outcome.failure)
        : undefined;
      if (next === undefined) {
        dispatch({ type: "failed", failure: outcome.failure });
        return;
      }
      candidate = next;
    }
    dispatch({ type: "failed", failure: "unknown" });
  };

  // One open per mount: a later prop change must not yank the operator out of
  // the folder they navigated to.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void load(initialPath, true);
  }, [initialPath]);

  useEffect(() => {
    if (!state.newFolderOpen) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [state.newFolderOpen]);

  const submitNewFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const listing = state.listing;
    if (!listing || state.creating || disabled) return;
    const name = state.newFolderName;
    // The reducer re-derives the same decision; this call only needs to know
    // whether to spend a request.
    const problem = validateWorkspaceFolderName(name);
    dispatch({ type: "create" });
    if (problem) return;
    const request = ++requestRef.current;
    const outcome = await adapterRef.current.create(
      listing.canonicalPath,
      name,
    );
    if (requestRef.current !== request) return;
    if (outcome.status === "failed") {
      dispatch({ type: "create-failed", failure: outcome.failure });
      return;
    }
    dispatch({ type: "created" });
    // §Client behaviour: creating a folder MOVES INTO it.
    await load(outcome.value.canonicalPath);
  };

  const listing = state.listing;
  const busy = disabled || state.loading || state.creating;
  const failure = state.failure ? workspaceBrowseCopy(state.failure) : null;
  const notices = listing ? workspaceListingNotices(listing) : [];
  const pathId = `${titleId}-browse-path`;
  const nameId = `${titleId}-browse-name`;
  const nameErrorId = `${titleId}-browse-name-error`;

  return (
    <div className={styles.body} data-workspace-browser="true">
      <div className={styles.browseBar}>
        <button
          type="button"
          className={styles.back}
          aria-label={t("Go to the parent folder")}
          disabled={busy || !listing?.parentPath}
          onClick={() => {
            if (listing?.parentPath) void load(listing.parentPath);
          }}
        >
          <ArrowUpIcon />
        </button>
        <span className={styles.browsePathText}>
          <span className={styles.fieldLabel} id={`${pathId}-label`}>
            {t("Current folder")}
          </span>
          <span
            id={pathId}
            className={styles.browsePath}
            data-browse-path="true"
            role="status"
            aria-live="polite"
          >
            {listing ? listing.canonicalPath : t("Loading folders…")}
          </span>
        </span>
      </div>

      {notices.length ? (
        <p className={styles.pathHelp} data-browse-notice="true">
          {notices
            .map((notice) => t(notice.source, notice.params ?? {}))
            .join(" ")}
        </p>
      ) : null}

      {failure ? (
        <p className={styles.validation} role="alert" data-browse-error="true">
          {`${t(failure.message)} ${t(failure.nextStep)}`}
        </p>
      ) : null}

      {canCreateWorkspaceFolder(listing) ? (
        state.newFolderOpen ? (
          <form className={styles.newFolder} onSubmit={submitNewFolder}>
            <label className={styles.fieldLabel} htmlFor={nameId}>
              {t("New folder name")}
            </label>
            <input
              ref={nameRef}
              id={nameId}
              className={styles.pathInput}
              type="text"
              value={state.newFolderName}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              aria-invalid={state.nameProblem ? "true" : undefined}
              {...(state.nameProblem
                ? { "aria-describedby": nameErrorId }
                : {})}
              onChange={(event) =>
                dispatch({ type: "new-folder-name", name: event.target.value })
              }
            />
            {state.nameProblem ? (
              <p id={nameErrorId} className={styles.validation} role="alert">
                {t(workspaceFolderNameCopy(state.nameProblem))}
              </p>
            ) : null}
            <div className={styles.footer}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={state.creating}
                onClick={() => dispatch({ type: "new-folder-cancel" })}
              >
                {t("Cancel")}
              </button>
              <button
                type="submit"
                className={styles.primaryButton}
                disabled={busy}
              >
                {state.creating ? t("Creating…") : t("Create folder")}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className={styles.addButton}
            disabled={busy}
            onClick={() => dispatch({ type: "new-folder-open" })}
          >
            <PlusIcon />
            <span>{t("New folder")}</span>
          </button>
        )
      ) : null}

      {state.loading && !listing ? (
        <div className={styles.state} role="status" aria-live="polite">
          <SkeletonRows rows={3} />
          <span>{t("Loading folders…")}</span>
        </div>
      ) : null}

      {listing ? (
        listing.entries.length ? (
          <ul className={styles.workspaceList} aria-label={t("Subfolders")}>
            {listing.entries.map((entry) => (
              <li key={entry.path} className={styles.browseRow}>
                <button
                  type="button"
                  className={styles.workspace}
                  aria-label={t("Open folder {value0}", { value0: entry.name })}
                  disabled={busy}
                  onClick={() => void load(entry.path)}
                >
                  <span className={styles.folder} aria-hidden="true">
                    <FolderIcon />
                  </span>
                  <span className={styles.workspaceText}>
                    <span className={styles.workspaceName}>{entry.name}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  aria-label={t("Use folder {value0}", { value0: entry.name })}
                  disabled={busy}
                  onClick={() => onChoose(entry.path)}
                >
                  {t("Use")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.pathHelp} data-browse-empty="true">
            {t("No subfolders here.")}
          </p>
        )
      ) : null}

      <div className={styles.formSpacer} />
      <div className={styles.footer}>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={state.creating}
          onClick={onBack}
        >
          {t("Back to the path")}
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy || !listing}
          onClick={() => {
            if (listing) onChoose(listing.canonicalPath);
          }}
        >
          {t("Use this folder")}
        </button>
      </div>
    </div>
  );
}
