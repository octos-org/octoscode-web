import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { RecentWorkspace } from "../workspace/workspace-recents.ts";
import { formatRelativeTime } from "../shell/relative-time.ts";
import { useUiText } from "../preferences/ui-text.tsx";
import { FolderIcon, PlusIcon } from "../../ui/Icon.tsx";
import { CloseIcon, MenuIcon, RefreshIcon } from "../../ui/ShellIcons.tsx";
import type { RemoteCatalogSnapshot } from "./remote-catalog.ts";
import type { RemoteLink } from "./remote-link.ts";
import type { RemoteOverview, RemoteRow } from "./remote-model.ts";
import { WorkspaceFolderBrowser } from "../workspace-create/WorkspaceFolderBrowser.tsx";
import type { WorkspaceBrowseAdapter } from "../workspace-create/workspace-browse.ts";
import { TaskTemplateHome } from "../templates/TaskTemplateHome.tsx";
import type { TaskTemplate } from "../templates/task-templates.ts";
import type { UiLanguage } from "../preferences/model.ts";
import type { TemplateLaunchDraft } from "../connection/preferences.ts";
import styles from "./RemoteHome.module.css";

export interface RemoteHomeProps {
  overview: RemoteOverview;
  browse: WorkspaceBrowseAdapter | null;
  folders: readonly RecentWorkspace[];
  folderStates: RemoteCatalogSnapshot;
  link: RemoteLink;
  /** Oldest successful listing across watched folders, for the status line. */
  listedAt: number | null;
  openingKey: string | null;
  openError: string | null;
  /**
   * T-0361: the server can create sessions and the phone is online, so each
   * watched folder may offer "new session here". Null hides the action.
   */
  canCreateSession: boolean;
  /** Path whose create is in flight; the row shows progress and stays single. */
  createKey: string | null;
  language: UiLanguage;
  templateDraft: TemplateLaunchDraft | null;
  now: number;
  onOpen: (row: RemoteRow) => void;
  onAddFolder: (path: string) => void;
  onRemoveFolder: (path: string) => void;
  onNewSession: (path: string, template?: TaskTemplate) => void;
  onRefresh: () => void;
  onOpenSessions: () => void;
  onOpenFull: () => void;
}

/**
 * The phone overview: what waits for me, what runs, what finished lately.
 * Every row is one tap into that session's conversation, where the approval
 * card, Stop and the composer already live.
 */
export function RemoteHome(props: RemoteHomeProps) {
  const t = useUiText();
  const { overview, folders, link } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateFolder, setTemplateFolder] = useState<string | null>(
    props.templateDraft?.workspacePath ?? null,
  );
  const pickerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (templateFolder) pickerRef.current?.scrollIntoView({ block: "start" });
  }, [templateFolder]);
  const selectedFolder = folders.find(
    (folder) => folder.path === templateFolder,
  );
  // Adding or removing a watched folder happens at the bottom of the page,
  // below the status sections. Bring Waiting/Running back into view so the
  // phone answers "is there work?" immediately — never on data refresh or
  // when the user scrolled on their own.
  const revealStatus = () => scrollRef.current?.scrollTo({ top: 0 });
  const time = (value: number | null) => {
    const label =
      value === null ? undefined : formatRelativeTime(value, props.now);
    return label ? t(label) : null;
  };
  const clock = (value: number) =>
    new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);

  return (
    <section className={styles.remote} aria-labelledby="remote-title">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("Open sessions")}
          onClick={props.onOpenSessions}
        >
          <MenuIcon size={20} />
        </button>
        <h1 id="remote-title">{t("Remote control")}</h1>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={t("Refresh")}
          disabled={link.kind !== "online"}
          onClick={props.onRefresh}
        >
          <RefreshIcon size={18} />
        </button>
      </header>

      <p className={styles.link} data-link={link.kind} role="status">
        <span className={styles.linkDot} aria-hidden="true" />
        <span>
          {link.kind === "online"
            ? props.listedAt === null
              ? t("Connected to Octos")
              : t("Connected to Octos · updated {time}", {
                  time: clock(props.listedAt),
                })
            : link.kind === "reconnecting"
              ? t("Connection lost. Reconnecting (attempt {count})…", {
                  count: Math.max(1, link.attempt),
                })
              : t(
                  "Can't reach Octos. The server on your computer may be off, or this phone lost its network. Nothing is sent until it is back.",
                )}
          {link.kind !== "online" && props.listedAt !== null
            ? " " +
              t("The list below is from {time}.", {
                time: clock(props.listedAt),
              })
            : null}
        </span>
      </p>

      <div className={styles.scroll} ref={scrollRef}>
        {props.openError ? (
          <p className={styles.error} role="alert">
            {props.openError}
          </p>
        ) : null}

        {folders.length === 0 ? (
          <div className={styles.empty}>
            <h2>{t("Pick the folders to watch")}</h2>
            <p>
              {t(
                "Add a project folder from this server. Its running sessions, approvals and recent results then show up here.",
              )}
            </p>
          </div>
        ) : (
          <>
            <RemoteSection
              title={t("Waiting for you")}
              rows={overview.waiting}
              empty={t("Nothing is waiting for your approval or answer.")}
              tone="waiting"
              {...props}
              time={time}
            />
            <RemoteSection
              title={t("Running")}
              rows={overview.running}
              empty={t("No session is running.")}
              tone="running"
              {...props}
              time={time}
            />
            <RemoteSection
              title={t("Recent")}
              rows={overview.recent}
              empty={t("No recent sessions in these folders.")}
              tone="recent"
              {...props}
              time={time}
            />
          </>
        )}

        <FolderList
          folders={folders}
          states={props.folderStates}
          browse={props.browse}
          online={link.kind === "online"}
          canCreateSession={props.canCreateSession}
          createKey={props.createKey}
          onAdd={props.onAddFolder}
          onRemove={props.onRemoveFolder}
          onNewSession={props.onNewSession}
          onTemplates={setTemplateFolder}
          onChanged={revealStatus}
        />

        {selectedFolder ? (
          <section
            className={styles.templatePicker}
            ref={pickerRef}
            aria-label={t("Choose a new session template")}
          >
            <button
              type="button"
              className={styles.addButton}
              onClick={() => setTemplateFolder(null)}
            >
              {t("Close templates")}
            </button>
            <TaskTemplateHome
              variant="workspace"
              language={props.language}
              workspaceName={selectedFolder.name}
              notice={
                props.templateDraft?.workspacePath === selectedFolder.path
                  ? {
                      kind: "pending",
                      templateId: props.templateDraft.templateId,
                    }
                  : null
              }
              templatesDisabled={
                !props.canCreateSession ||
                link.kind !== "online" ||
                props.createKey !== null
              }
              onUse={(template) =>
                props.onNewSession(selectedFolder.path, template)
              }
            />
          </section>
        ) : null}
        <button
          type="button"
          className={styles.fullLink}
          onClick={props.onOpenFull}
        >
          {t("Open the full workspace")}
        </button>
      </div>
    </section>
  );
}

function RemoteSection(
  props: RemoteHomeProps & {
    title: string;
    rows: readonly RemoteRow[];
    empty: string;
    tone: "waiting" | "running" | "recent";
    time: (value: number | null) => string | null;
  },
) {
  const t = useUiText();
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 id={headingId}>
        {props.title}
        {props.rows.length ? (
          <span className={styles.count}>{props.rows.length}</span>
        ) : null}
      </h2>
      {props.rows.length === 0 ? (
        <p className={styles.none}>{props.empty}</p>
      ) : (
        <ul className={styles.rows}>
          {props.rows.map((row) => {
            const opening = props.openingKey === row.key;
            const title = row.title?.trim() || t("Untitled session");
            return (
              <li key={row.key}>
                <button
                  type="button"
                  className={styles.row}
                  data-state={row.state}
                  aria-busy={opening || undefined}
                  disabled={
                    Boolean(props.openingKey) || props.link.kind !== "online"
                  }
                  onClick={() => props.onOpen(row)}
                >
                  <span className={styles.mark} aria-hidden="true" />
                  <span className={styles.rowText}>
                    <strong>{title}</strong>
                    <small>{rowDetail(row, props.tone, t, props.time)}</small>
                  </span>
                  <span className={styles.action}>
                    {opening
                      ? t("Opening…")
                      : props.tone === "waiting"
                        ? t("Review")
                        : t("Open")}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function rowDetail(
  row: RemoteRow,
  tone: "waiting" | "running" | "recent",
  t: ReturnType<typeof useUiText>,
  time: (value: number | null) => string | null,
): string {
  if (tone === "waiting") {
    const waiting = row.waitingFor;
    if (waiting?.kind === "question")
      return t("Asks you: {title}", { title: t(waiting.title) });
    return [
      row.folderName,
      waiting?.toolName,
      waiting ? t(waiting.title) : t("Waiting for approval"),
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const outcome =
    row.state === "running"
      ? t("Running")
      : row.state === "failed"
        ? t("Failed")
        : row.state === "completed"
          ? t("Completed")
          : null;
  return [row.folderName, outcome, time(row.updatedAt)]
    .filter(Boolean)
    .join(" · ");
}

function FolderList(props: {
  folders: readonly RecentWorkspace[];
  states: RemoteCatalogSnapshot;
  browse: WorkspaceBrowseAdapter | null;
  online: boolean;
  canCreateSession: boolean;
  createKey: string | null;
  onAdd: (path: string) => void;
  onRemove: (path: string) => void;
  onNewSession: (path: string) => void;
  onTemplates: (path: string) => void;
  onChanged: () => void;
}) {
  const t = useUiText();
  const inputId = useId();
  const [draft, setDraft] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const path = draft.trim();
    if (!path) return;
    props.onAdd(path);
    setDraft("");
    props.onChanged();
  };
  return (
    <section className={styles.section} aria-labelledby={`${inputId}-title`}>
      <h2 id={`${inputId}-title`}>{t("Watched folders")}</h2>
      {props.folders.length ? (
        <ul className={styles.folders}>
          {props.folders.map((folder) => {
            const state = props.states.get(folder.path);
            return (
              <li key={folder.path} className={styles.folder}>
                <FolderIcon size={16} />
                <span className={styles.folderText}>
                  <strong>{folder.name}</strong>
                  <small>
                    {state?.status === "error"
                      ? t("Could not list: {reason}", {
                          reason: state.error ?? "",
                        })
                      : folder.path}
                  </small>
                </span>
                <div className={styles.folderActions}>
                  <button
                    type="button"
                    className={styles.addButton}
                    aria-label={t("New from template in {name}", {
                      name: folder.name,
                    })}
                    disabled={
                      !props.online ||
                      !props.canCreateSession ||
                      props.createKey !== null
                    }
                    onClick={() => props.onTemplates(folder.path)}
                  >
                    {t("From template")}
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={t("New session in {value0}", {
                      value0: folder.name,
                    })}
                    disabled={
                      !props.online ||
                      !props.canCreateSession ||
                      props.createKey !== null
                    }
                    aria-busy={props.createKey === folder.path || undefined}
                    onClick={() => props.onNewSession(folder.path)}
                  >
                    <PlusIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label={t("Stop watching {name}", {
                      name: folder.name,
                    })}
                    onClick={() => {
                      props.onRemove(folder.path);
                      props.onChanged();
                    }}
                  >
                    <CloseIcon size={16} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {props.browse ? (
        <button
          type="button"
          className={styles.addButton}
          disabled={!props.online}
          onClick={() => setBrowsing((value) => !value)}
        >
          {t("Browse server folders")}
        </button>
      ) : null}
      {browsing && props.browse ? (
        <WorkspaceFolderBrowser
          adapter={props.browse}
          initialPath={null}
          titleId={inputId}
          disabled={!props.online}
          onChoose={(path) => {
            props.onAdd(path);
            setBrowsing(false);
            props.onChanged();
          }}
          onBack={() => setBrowsing(false)}
        />
      ) : null}
      <form className={styles.addFolder} onSubmit={submit}>
        <label htmlFor={inputId} className="sr-only">
          {t("Server folder path")}
        </label>
        <input
          id={inputId}
          value={draft}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="url"
          placeholder={t("/path/to/project on the server")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          className={styles.addButton}
          disabled={!draft.trim()}
        >
          <PlusIcon size={16} />
          {t("Watch")}
        </button>
      </form>
    </section>
  );
}
