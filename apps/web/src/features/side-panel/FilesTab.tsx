import { useEffect, useRef, useState } from "react";
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
import styles from "./SessionPanelTabs.module.css";

export interface FilesTabProps {
  /** The Session's workspace folder, absolute. */
  root: string;
  /** Server folder listing (directories only); null when not offered. */
  browse: WorkspaceBrowseAdapter | null;
  changes: readonly SessionFileChange[];
  onOpenChange: (change: SessionFileChange) => void;
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

/**
 * The workspace folder as a tree. Folders come from the server's listing;
 * files are the ones this Session changed — Core lists directories only, and
 * offers no read of other workspace files.
 */
export function FilesTab({
  root,
  browse,
  changes,
  onOpenChange,
}: FilesTabProps) {
  const t = useUiText();
  const [folders, setFolders] = useState(
    () => new Map<string, FolderState>([["", { absolute: root }]]),
  );
  const [expanded, setExpanded] = useState(() => new Set<string>([""]));
  const foldersRef = useRef(folders);
  foldersRef.current = folders;
  const generation = useRef(0);

  useEffect(() => {
    const fresh = new Map([["", { absolute: root }]]);
    generation.current += 1;
    foldersRef.current = fresh;
    setFolders(fresh);
    setExpanded(new Set([""]));
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
            ? "Shows folders, and the files Octos changed in this session. The server can't list or open other files yet."
            : "Shows the files Octos changed in this session. This server can't list folders or open other files yet.",
        )}
      </p>
    </div>
  );
}

function TreeRow({
  node,
  expanded,
  onToggle,
  onOpen,
}: {
  node: FileTreeNode;
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
