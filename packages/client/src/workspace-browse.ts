import { isRecord } from "./rpc.ts";
import { OctosUiProtocolError } from "./protocol-error.ts";
import {
  APPUI_ONBOARDING_FEATURES,
  APPUI_ONBOARDING_METHODS,
} from "./onboarding-methods.ts";
import type { UiProtocolCapabilities } from "./types.ts";

/**
 * WEB-WORKSPACE-BROWSER-CONTRACT-5000 — `onboarding/workspace_list` and
 * `onboarding/workspace_create`, behind the advertised feature
 * `onboarding.workspace_browse.v1`.
 *
 * The browser cannot read the server's filesystem and its own directory picker
 * returns a handle without a path, so workspace creation browses the SERVER.
 * Neither side invents fields: a result that carries anything the contract does
 * not define is still accepted, but every field this client reads is validated
 * here and an invalid result is refused rather than half-rendered.
 */

/** §1: "At most 500 entries; `truncated` is true when more existed." */
export const WORKSPACE_BROWSE_MAX_ENTRIES = 500;
/** §2: "1..=255 bytes" — the server is the authority; the client pre-checks. */
export const WORKSPACE_FOLDER_NAME_MAX_BYTES = 255;
const MAX_PATH = 4_096;

export interface WorkspaceListParams {
  /** Absolute, `~`-prefixed, or null for the server's own working directory. */
  path: string | null;
}

export interface WorkspaceFolderEntry {
  name: string;
  /** The canonical absolute path of this subdirectory. */
  path: string;
  /** Whether a folder could be created inside this subdirectory. */
  writable: boolean;
}

export interface WorkspaceListResult {
  canonical_path: string;
  /** null at the filesystem root, or when the parent is a banned system path. */
  parent_path: string | null;
  /** About `canonical_path` itself: gates the client's New folder affordance. */
  writable: boolean;
  /** DIRECTORIES ONLY, sorted case-insensitively by name. */
  entries: WorkspaceFolderEntry[];
  truncated: boolean;
  hidden_skipped: number;
}

export interface WorkspaceCreateParams {
  parent: string;
  name: string;
}

export interface WorkspaceCreateResult {
  canonical_path: string;
  /** false when a directory of that name already existed — success, not error. */
  created: boolean;
}

export const WORKSPACE_LIST_REFUSAL_KINDS = [
  "workspace_list_invalid_path",
  "workspace_list_not_found",
  "workspace_list_not_a_directory",
  "workspace_list_permission_denied",
  "workspace_list_root_escape",
  "profile_local_unsupported",
] as const;

export const WORKSPACE_CREATE_REFUSAL_KINDS = [
  "workspace_create_invalid_name",
  "workspace_create_parent_not_found",
  "workspace_create_parent_not_a_directory",
  "workspace_create_permission_denied",
  "workspace_create_root_escape",
  "workspace_create_exists_not_directory",
  "profile_local_unsupported",
] as const;

export type WorkspaceListRefusalKind =
  (typeof WORKSPACE_LIST_REFUSAL_KINDS)[number];
export type WorkspaceCreateRefusalKind =
  (typeof WORKSPACE_CREATE_REFUSAL_KINDS)[number];
export type WorkspaceBrowseRefusalKind =
  WorkspaceListRefusalKind | WorkspaceCreateRefusalKind;

export interface WorkspaceBrowseRefusal {
  readonly kind: WorkspaceBrowseRefusalKind;
  /** Only `*_root_escape` carries it; never rendered raw. */
  readonly bannedRoot?: string;
}

const ALL_REFUSAL_KINDS: readonly string[] = [
  ...WORKSPACE_LIST_REFUSAL_KINDS,
  ...WORKSPACE_CREATE_REFUSAL_KINDS,
];

/**
 * Whitelist ONE typed kind from a server protocol error's `data.kind`.
 * IDENTITY, not duck-typing: only the real client protocol error is eligible,
 * so a plain Error carrying a matching `.data.kind` stays an untyped failure.
 */
export function workspaceBrowseRefusal(
  serverError: unknown,
): WorkspaceBrowseRefusal | null {
  if (!(serverError instanceof OctosUiProtocolError)) return null;
  const data = serverError.data;
  if (!isRecord(data)) return null;
  const kind = data.kind;
  if (typeof kind !== "string" || !ALL_REFUSAL_KINDS.includes(kind)) {
    return null;
  }
  const bannedRoot = path(data.banned_root);
  return {
    kind: kind as WorkspaceBrowseRefusalKind,
    ...(bannedRoot ? { bannedRoot } : {}),
  };
}

/**
 * §Gate: the feature advertised in `config/capabilities/list`. A client that
 * does not see it keeps the typed-path form and hides every browsing
 * affordance (fail closed) — an advertised METHOD alone is never the gate.
 */
export function supportsWorkspaceBrowse(
  capabilities: UiProtocolCapabilities | undefined,
): boolean {
  return (
    capabilities?.supported_features?.includes(
      APPUI_ONBOARDING_FEATURES.WORKSPACE_BROWSE_V1,
    ) ?? false
  );
}

export function parseWorkspaceListResult(
  value: unknown,
): WorkspaceListResult | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const canonicalPath = path(value.canonical_path);
  if (
    !canonicalPath ||
    typeof value.writable !== "boolean" ||
    typeof value.truncated !== "boolean" ||
    !isCount(value.hidden_skipped) ||
    value.entries.length > WORKSPACE_BROWSE_MAX_ENTRIES
  ) {
    return null;
  }
  // Absent and explicit null both mean "no parent" — a root, or a parent the
  // server refuses to disclose. Anything else must be a usable path.
  let parentPath: string | null = null;
  if (value.parent_path !== null && value.parent_path !== undefined) {
    parentPath = path(value.parent_path);
    if (!parentPath) return null;
  }
  const entries: WorkspaceFolderEntry[] = [];
  for (const source of value.entries) {
    const entry = parseWorkspaceFolderEntry(source);
    if (!entry) return null;
    entries.push(entry);
  }
  return {
    canonical_path: canonicalPath,
    parent_path: parentPath,
    writable: value.writable,
    entries,
    truncated: value.truncated,
    hidden_skipped: value.hidden_skipped,
  };
}

export function parseWorkspaceCreateResult(
  value: unknown,
): WorkspaceCreateResult | null {
  if (!isRecord(value) || typeof value.created !== "boolean") return null;
  const canonicalPath = path(value.canonical_path);
  return canonicalPath
    ? { canonical_path: canonicalPath, created: value.created }
    : null;
}

function parseWorkspaceFolderEntry(
  value: unknown,
): WorkspaceFolderEntry | null {
  if (!isRecord(value) || typeof value.writable !== "boolean") return null;
  const name = path(value.name);
  const entryPath = path(value.path);
  // A file entry would be a contract violation (§1 "DIRECTORIES ONLY"), and a
  // name carrying a separator could not be joined onto the canonical path.
  if (!name || !entryPath || name.includes("/") || name.includes("\\")) {
    return null;
  }
  return { name, path: entryPath, writable: value.writable };
}

function path(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PATH
    ? value
    : null;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const WORKSPACE_BROWSE_METHODS = {
  WORKSPACE_LIST: APPUI_ONBOARDING_METHODS.WORKSPACE_LIST,
  WORKSPACE_CREATE: APPUI_ONBOARDING_METHODS.WORKSPACE_CREATE,
} as const;
