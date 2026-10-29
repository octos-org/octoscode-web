import type { SessionFileChange } from "./session-changes.ts";

/**
 * The Files tab's tree: folders the server listed (directories only, by
 * contract) merged with the files this Session changed. Paths are relative to
 * the workspace root; "" is the root itself.
 */
export type FileTreeNode =
  | {
      kind: "folder";
      name: string;
      path: string;
      /** Changed files somewhere below this folder. */
      changed: number;
    }
  | { kind: "file"; name: string; path: string; change: SessionFileChange };

/** Child folder names the server listed, by relative folder path. */
export type FolderListings = ReadonlyMap<string, readonly string[]>;

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

export function isOutsideWorkspace(path: string): boolean {
  return (
    path.startsWith("/") ||
    path.startsWith("~") ||
    path === ".." ||
    path.startsWith("../") ||
    /^[A-Za-z]:[\\/]/.test(path)
  );
}

/** Folders first, then files; each sorted the way a file manager would. */
export function folderChildren(
  folder: string,
  listings: FolderListings,
  changes: readonly SessionFileChange[],
): FileTreeNode[] {
  const prefix = folder ? `${folder}/` : "";
  const folders = new Map<string, number>();
  for (const name of listings.get(folder) ?? []) folders.set(name, 0);
  const files: FileTreeNode[] = [];
  for (const change of changes) {
    if (isOutsideWorkspace(change.path) || !change.path.startsWith(prefix))
      continue;
    const rest = change.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash < 0) {
      if (rest)
        files.push({ kind: "file", name: rest, path: change.path, change });
      continue;
    }
    const name = rest.slice(0, slash);
    folders.set(name, (folders.get(name) ?? 0) + 1);
  }
  return [
    ...[...folders]
      .sort(([left], [right]) => collator.compare(left, right))
      .map(([name, changed]): FileTreeNode => ({
        kind: "folder",
        name,
        path: prefix + name,
        changed,
      })),
    ...files.sort((left, right) => collator.compare(left.name, right.name)),
  ];
}

export function joinWorkspace(root: string, path: string): string {
  const base = root.replace(/\/+$/, "");
  return path ? `${base}/${path}` : base || "/";
}
