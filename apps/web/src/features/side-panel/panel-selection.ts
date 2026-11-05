import { useState } from "react";
import {
  workspaceRelativePath,
  type SessionFileChange,
} from "./session-changes.ts";

const KEY = "octoscode-web:panel-selection:";

/** Only a focus hint. References and preview IDs always come from this Session. */
export function resolvePanelFile(
  path: string | null,
  root: string,
  changes: readonly SessionFileChange[],
  delivered: readonly string[],
) {
  const change = changes.find((item) => item.path === path) ?? null;
  const reference =
    delivered.find((item) => workspaceRelativePath(item, root) === path) ??
    null;
  return { change, reference, found: Boolean(change || reference) };
}

export function readPanelSelection(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  scope: string,
): string | null {
  try {
    const value: unknown = JSON.parse(storage?.getItem(KEY + scope) ?? "null");
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function usePanelSelection(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  scope: string,
) {
  const [selection, setSelection] = useState(() => ({
    scope,
    path: readPanelSelection(storage, scope),
  }));
  let current = selection;
  if (selection.scope !== scope) {
    current = { scope, path: readPanelSelection(storage, scope) };
    setSelection(current);
  }
  return {
    path: current.path,
    select(path: string | null) {
      setSelection({ scope, path });
      try {
        if (path === null) storage?.removeItem(KEY + scope);
        else storage?.setItem(KEY + scope, JSON.stringify(path));
      } catch {
        // Storage is optional for focus; the in-memory selection still works.
      }
    },
  };
}
