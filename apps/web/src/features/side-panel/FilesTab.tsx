import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDownIcon, FileIcon, FolderIcon } from "../../ui/Icon.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  workspaceBrowseCopy,
  type WorkspaceBrowseAdapter,
  type WorkspaceBrowseFailure,
} from "../workspace-create/workspace-browse.ts";
import {
  folderChildren,
  isOutsideWorkspace,
  joinWorkspace,
  type FileTreeNode,
} from "./file-tree.ts";
import type { SessionFileChange } from "./session-changes.ts";
import type { WorkspaceTreeEntry } from "@octos-org/octoscode-client/session-files";
import styles from "./SessionPanelTabs.module.css";

export interface FilesTabProps {
  /** The Session's workspace folder, absolute. */
  root: string;
  selectedPath: string | null;
  /** Server folder listing (directories only); null when not offered. */
  browse: WorkspaceBrowseAdapter | null;
  /**
   * The real workspace tree (T-0416): one folder's page per call, `prefix`
   * workspace-relative. Null before probing; the adapter resolves
   * `supported: false` on an older Core, which keeps the browse fallback.
   */
  tree: {
    list(
      prefix: string,
      cursor?: string,
    ): Promise<
      | {
          supported: true;
          page: { entries: WorkspaceTreeEntry[]; nextCursor: string | null };
        }
      | { supported: false }
    >;
  } | null;
  /** The host's probe of the root page: undefined while probing, null on older Cores. */
  treePage:
    | { entries: WorkspaceTreeEntry[]; nextCursor: string | null }
    | null
    | undefined;
  changes: readonly SessionFileChange[];
  onOpenChange: (change: SessionFileChange) => void;
  /** Open a workspace file that is not a change (tree mode): select + preview. */
  onOpenPath: (path: string) => void;
}

interface FolderState {
  /** Absolute path to list it by: the server's own path once it gave one. */
  absolute: string;
  names?: readonly string[];
  loading?: boolean;
  failure?: WorkspaceBrowseFailure;
  truncated?: boolean;
  hidden?: number;
}

interface TreeFolderState {
  entries?: WorkspaceTreeEntry[];
  nextCursor?: string | null;
  loading?: boolean;
  failed?: boolean;
}

/**
 * The workspace as the server lists it (T-0417): folders and files, one
 * folder page at a time, changed files still badged from this Session's
 * record. Probing an older Core resolves `supported: false` and the caller
 * keeps the browse/changes view instead of an invented tree.
 */
function WorkspaceTree({
  root,
  selectedPath,
  tree,
  firstPage,
  changes,
  onOpenChange,
  onOpenPath,
}: {
  root: string;
  selectedPath: string | null;
  tree: NonNullable<FilesTabProps["tree"]>;
  /** The probe's root page, so the tree does not list the root twice. */
  firstPage: { entries: WorkspaceTreeEntry[]; nextCursor: string | null };
  changes: readonly SessionFileChange[];
  onOpenChange: (change: SessionFileChange) => void;
  onOpenPath: (path: string) => void;
}) {
  const t = useUiText();
  const [folders, setFolders] = useState<Map<string, TreeFolderState>>(
    () =>
      new Map([
        ["", { entries: firstPage.entries, nextCursor: firstPage.nextCursor }],
      ]),
  );
  const [expanded, setExpanded] = useState(() => new Set<string>([""]));
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const generation = useRef(0);

  useEffect(() => {
    generation.current += 1;
    return () => {
      generation.current += 1;
    };
    // The root page arrives already probed; nothing to reload on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, tree]);
  useEffect(() => {
    if (!selectedPath || isOutsideWorkspace(selectedPath)) return;
    const parents = selectedPath
      .split("/")
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...parents]));
    // A restored selection (reload) expands its folders from server facts,
    // not from the browser's last listing (T-0417).
    for (const parent of parents) {
      const state = foldersRef.current.get(parent);
      if (!state?.entries && !state?.loading) void load(parent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPath]);

  const load = async (prefix: string, cursor?: string) => {
    const requestGeneration = generation.current;
    const current = foldersRef.current.get(prefix) ?? {};
    if (current.loading || (current.entries && cursor === undefined)) return;
    setFolders((map) =>
      new Map(map).set(prefix, { ...current, loading: true, failed: false }),
    );
    try {
      const result = await tree.list(prefix, cursor);
      if (requestGeneration !== generation.current) return;
      if (!result.supported) return; // Caller watches the probe itself.
      setFolders((map) =>
        new Map(map).set(prefix, {
          entries: cursor
            ? [...(current.entries ?? []), ...result.page.entries]
            : result.page.entries,
          nextCursor: result.page.nextCursor,
        }),
      );
    } catch {
      if (requestGeneration !== generation.current) return;
      setFolders((map) =>
        new Map(map).set(prefix, { ...current, failed: true }),
      );
    }
  };

  const toggle = (path: string) => {
    const open = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
    if (open) void load(path);
  };

  const changeByPath = new Map(changes.map((change) => [change.path, change]));
  const changedUnder = (prefix: string) =>
    changes.filter(
      (change) =>
        !isOutsideWorkspace(change.path) &&
        change.path.startsWith(prefix ? `${prefix}/` : ""),
    ).length;

  const renderFolder = (prefix: string): ReactNode => {
    const state = folders.get(prefix);
    const entries = state?.entries ?? [];
    const nodes: ReactNode[] = [];
    for (const entry of entries) {
      if (entry.kind === "dir") {
        nodes.push(
          <li key={entry.path}>
            <TreeFolderRow
              name={entry.name}
              changed={changedUnder(entry.path)}
              expanded={expanded.has(entry.path)}
              onToggle={() => toggle(entry.path)}
            />
            {expanded.has(entry.path) ? renderFolder(entry.path) : null}
          </li>,
        );
      } else {
        const change = changeByPath.get(entry.path);
        nodes.push(
          <li key={entry.path}>
            <TreeFileRow
              name={entry.name}
              selected={entry.path === selectedPath}
              change={change ?? null}
              onOpen={() =>
                change ? onOpenChange(change) : onOpenPath(entry.path)
              }
            />
          </li>,
        );
      }
    }
    // A changed file the listing did not return (deleted since, or below the
    // listed depth) still shows from this Session's record.
    const listed = new Set(entries.map((entry) => entry.path));
    for (const change of changes) {
      const directParent = change.path.split("/").slice(0, -1).join("/");
      if (
        directParent === prefix &&
        !listed.has(change.path) &&
        !isOutsideWorkspace(change.path)
      ) {
        nodes.push(
          <li key={change.path}>
            <TreeFileRow
              name={change.path.split("/").at(-1)!}
              selected={change.path === selectedPath}
              change={change}
              onOpen={() => onOpenChange(change)}
            />
          </li>,
        );
      }
    }
    return (
      <ul className={styles.tree} role="list">
        {nodes}
        {state?.loading ? (
          <li className={styles.treeNote} role="status">
            {t("Loading…")}
          </li>
        ) : null}
        {state?.failed ? (
          <li className={styles.treeNote}>
            {t("Couldn't read this folder.")}{" "}
            <button
              type="button"
              onClick={() =>
                void load(
                  prefix,
                  foldersRef.current.get(prefix)?.nextCursor ?? undefined,
                )
              }
            >
              {t("Try again")}
            </button>
          </li>
        ) : null}
        {state?.nextCursor ? (
          <li className={styles.treeNote}>
            <button
              type="button"
              onClick={() => void load(prefix, state.nextCursor!)}
            >
              {t("Show more")}
            </button>
          </li>
        ) : null}
        {state?.entries && !entries.length && !nodes.length ? (
          <li className={styles.treeNote}>{t("Nothing here.")}</li>
        ) : null}
      </ul>
    );
  };

  const outside = changes.filter((change) => isOutsideWorkspace(change.path));
  const rootName =
    root.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ?? root;

  return (
    <div className={styles.stack}>
      <section aria-label={t("Workspace folder")}>
        <p className={styles.treeRoot} title={root}>
          <FolderIcon size={16} />
          <strong>{rootName || root}</strong>
        </p>
        {renderFolder("")}
      </section>
      {outside.length ? (
        <section className={styles.section} aria-labelledby="files-outside">
          <div className={styles.sectionTitle}>
            <h3 id="files-outside">{t("Outside this folder")}</h3>
            <span>{outside.length}</span>
          </div>
          <ul className={styles.tree} role="list">
            {outside.map((change) => (
              <li key={change.path}>
                <TreeFileRow
                  name={change.path}
                  selected={change.path === selectedPath}
                  change={change}
                  onOpen={() => onOpenChange(change)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={styles.note}>
        {t("The workspace as the server lists it, one folder at a time.")}
      </p>
    </div>
  );
}

function TreeFolderRow({
  name,
  changed,
  expanded,
  onToggle,
}: {
  name: string;
  changed: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useUiText();
  return (
    <button
      type="button"
      className={styles.treeRow}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <ChevronDownIcon size={12} className={styles.treeChevron} />
      <FolderIcon size={15} />
      <span className={styles.treeName}>{name}</span>
      {changed ? (
        <span className={styles.treeBadge}>
          <span className="sr-only">
            {t("{count} changed", { count: changed })}
          </span>
          <span aria-hidden="true">{changed}</span>
        </span>
      ) : null}
    </button>
  );
}

function TreeFileRow({
  name,
  selected,
  change,
  onOpen,
}: {
  name: string;
  selected: boolean;
  change: SessionFileChange | null;
  onOpen: () => void;
}) {
  const t = useUiText();
  const status = !change
    ? null
    : change.operation === "create"
      ? "added"
      : change.operation === "delete"
        ? "deleted"
        : "modified";
  return (
    <button
      type="button"
      className={styles.treeRow}
      aria-current={selected ? "true" : undefined}
      title={
        change
          ? change.previewId
            ? t("Show the change to {name}", { name })
            : t("Core kept no diff for this change.")
          : t("Preview {name}", { name })
      }
      onClick={onOpen}
    >
      <span className={styles.treeChevron} />
      <FileIcon size={15} />
      <span className={styles.treeName}>{name}</span>
      {status ? (
        <span className={`file-status status-${status}`} aria-hidden="true">
          {status === "added" ? "A" : status === "deleted" ? "D" : "M"}
        </span>
      ) : null}
      {status ? (
        <span className="sr-only">
          {", "}
          {t(
            status === "added"
              ? "New"
              : status === "deleted"
                ? "Deleted"
                : "Edited",
          )}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The workspace folder as a tree. Folders come from the server's listing;
 * files are the ones this Session changed. Directory browsing does not give
 * us a complete workspace file tree.
 */
export function FilesTab(props: FilesTabProps) {
  const t = useUiText();
  const { root, tree, treePage } = props;
  // The host probes the tree listing; an older Core answers with the legacy
  // flat shape and we keep the browse/changes view (T-0417).
  if (!tree || treePage === null) return <BrowseFilesTab {...props} />;
  if (treePage === undefined) {
    return (
      <p className={styles.note} role="status">
        {t("Loading folders…")}
      </p>
    );
  }
  return (
    <WorkspaceTree
      root={root}
      selectedPath={props.selectedPath}
      tree={tree}
      firstPage={treePage}
      changes={props.changes}
      onOpenChange={props.onOpenChange}
      onOpenPath={props.onOpenPath}
    />
  );
}

function BrowseFilesTab({
  root,
  selectedPath,
  browse,
  changes,
  onOpenChange,
}: Omit<FilesTabProps, "tree" | "onOpenPath">) {
  const t = useUiText();

  const [folders, setFolders] = useState(
    () => new Map<string, FolderState>([["", { absolute: root }]]),
  );
  const [expanded, setExpanded] = useState(() => new Set<string>([""]));
  useEffect(() => {
    if (!selectedPath || isOutsideWorkspace(selectedPath)) return;
    const parents = selectedPath
      .split("/")
      .slice(0, -1)
      .map((_, index, parts) => parts.slice(0, index + 1).join("/"));
    setExpanded((current) => new Set([...current, ...parents]));
  }, [selectedPath]);
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const generation = useRef(0);

  useEffect(() => {
    const fresh = new Map([["", { absolute: root }]]);
    generation.current += 1;
    foldersRef.current = fresh;
    setFolders(fresh);
    void load("");
    return () => {
      generation.current += 1;
    };
    // `load` reads through a ref; reload only for a new root or browser.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root, browse]);

  const load = async (path: string) => {
    if (!browse) return;
    const requestGeneration = generation.current;
    const current = foldersRef.current.get(path) ?? {
      absolute: joinWorkspace(foldersRef.current.get("")!.absolute, path),
    };
    if (current.names || current.loading) return;
    const update = (next: FolderState) =>
      setFolders((map) => new Map(map).set(path, next));
    update({ ...current, loading: true });
    const outcome = await browse.list(current.absolute);
    if (requestGeneration !== generation.current) return;
    if (outcome.status === "failed") {
      update({ absolute: current.absolute, failure: outcome.failure });
      return;
    }
    const listing = outcome.value;
    setFolders((map) => {
      const next = new Map(map);
      next.set(path, {
        absolute: listing.canonicalPath,
        names: listing.entries.map((entry) => entry.name),
        truncated: listing.truncated,
        hidden: listing.hiddenSkipped,
      });
      for (const entry of listing.entries) {
        const child = path ? `${path}/${entry.name}` : entry.name;
        if (!next.has(child)) next.set(child, { absolute: entry.path });
      }
      return next;
    });
  };

  const listings = new Map<string, readonly string[]>();
  for (const [path, folder] of folders)
    if (folder.names) listings.set(path, folder.names);

  const toggle = (path: string) => {
    const open = !expanded.has(path);
    setExpanded((current) => {
      const next = new Set(current);
      if (open) next.add(path);
      else next.delete(path);
      return next;
    });
    if (open) void load(path);
  };

  const renderFolder = (path: string) => {
    const state = folders.get(path);
    const nodes = folderChildren(path, listings, changes);
    return (
      <ul className={styles.tree} role="list">
        {nodes.map((node) => (
          <li key={node.path}>
            <TreeRow
              selected={node.path === selectedPath}
              node={node}
              expanded={expanded.has(node.path)}
              onToggle={() => toggle(node.path)}
              onOpen={() => node.kind === "file" && onOpenChange(node.change)}
            />
            {node.kind === "folder" && expanded.has(node.path)
              ? renderFolder(node.path)
              : null}
          </li>
        ))}
        {state?.loading ? (
          <li className={styles.treeNote} role="status">
            {t("Loading folders…")}
          </li>
        ) : null}
        {/* A folder known from this Session's changes is real even when the
            listing fails; only an otherwise empty folder explains why. */}
        {state?.failure && !nodes.length ? (
          <li className={styles.treeNote}>
            {t(workspaceBrowseCopy(state.failure).message)}
          </li>
        ) : null}
        {state?.truncated ? (
          <li className={styles.treeNote}>
            {t("More folders here than the server lists at once.")}
          </li>
        ) : null}
        {!state?.loading && !state?.failure && !nodes.length ? (
          <li className={styles.treeNote}>
            {t(state?.names ? "No folders here." : "Nothing changed here yet.")}
          </li>
        ) : null}
      </ul>
    );
  };

  const outside = changes.filter((change) => isOutsideWorkspace(change.path));
  const rootName =
    root.replace(/\/+$/, "").split("/").filter(Boolean).at(-1) ?? root;

  return (
    <div className={styles.stack}>
      <section aria-label={t("Workspace folder")}>
        <p className={styles.treeRoot} title={root}>
          <FolderIcon size={16} />
          <strong>{rootName || root}</strong>
        </p>
        {renderFolder("")}
      </section>
      {outside.length ? (
        <section className={styles.section} aria-labelledby="files-outside">
          <div className={styles.sectionTitle}>
            <h3 id="files-outside">{t("Outside this folder")}</h3>
            <span>{outside.length}</span>
          </div>
          <ul className={styles.tree} role="list">
            {outside.map((change) => (
              <li key={change.path}>
                <TreeRow
                  selected={change.path === selectedPath}
                  node={{
                    kind: "file",
                    name: change.path,
                    path: change.path,
                    change,
                  }}
                  expanded={false}
                  onToggle={() => undefined}
                  onOpen={() => onOpenChange(change)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className={styles.note}>
        {t(
          browse
            ? "Shows folders and this session's changed files, not a complete workspace file tree."
            : "Shows this session's changed files. This server cannot list workspace folders.",
        )}
      </p>
    </div>
  );
}

function TreeRow({
  node,
  selected,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FileTreeNode;
  selected: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const t = useUiText();
  if (node.kind === "folder") {
    return (
      <button
        type="button"
        className={styles.treeRow}

        aria-expanded={expanded}
        onClick={onToggle}
      >
        <ChevronDownIcon size={12} className={styles.treeChevron} />
        <FolderIcon size={15} />
        <span className={styles.treeName}>{node.name}</span>
        {node.changed ? (
          <span className={styles.treeBadge}>
            <span className="sr-only">
              {t("{count} changed", { count: node.changed })}
            </span>
            <span aria-hidden="true">{node.changed}</span>
          </span>
        ) : null}
      </button>
    );
  }
  const status =
    node.change.operation === "create"
      ? "added"
      : node.change.operation === "delete"
        ? "deleted"
        : "modified";
  return (
    <button
      type="button"
      className={styles.treeRow}

      aria-current={selected ? "true" : undefined}
      disabled={!node.change.previewId}
      title={
        node.change.previewId
          ? t("Show the change to {name}", { name: node.name })
          : t("Core kept no diff for this change.")
      }
      onClick={onOpen}
    >
      <span className={styles.treeChevron} />
      <FileIcon size={15} />
      <span className={styles.treeName}>{node.name}</span>
      <span className={`file-status status-${status}`} aria-hidden="true">
        {status === "added" ? "A" : status === "deleted" ? "D" : "M"}
      </span>
      <span className="sr-only">
        {", "}
        {t(
          status === "added"
            ? "New"
            : status === "deleted"
              ? "Deleted"
              : "Edited",
        )}
      </span>
    </button>
  );
}
