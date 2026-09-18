/**
 * Server-folder browsing for the Add workspace form
 * (WEB-WORKSPACE-BROWSER-CONTRACT-5000, client half).
 *
 * Pure: path arithmetic, the name rules the server enforces, the typed-kind →
 * product copy table, and the browse reducer. The component only wires these
 * to the transport. No server string is ever rendered — every refusal becomes
 * bounded copy with a next step, which the UI text layer then translates.
 */

/** §2: "1..=255 bytes". */
export const WORKSPACE_FOLDER_NAME_MAX_BYTES = 255;
/** A typed path is walked up at most this far looking for a listable ancestor. */
export const WORKSPACE_BROWSE_MAX_ASCENT = 32;

export interface WorkspaceFolderListing {
  readonly canonicalPath: string;
  readonly parentPath: string | null;
  readonly writable: boolean;
  readonly entries: readonly {
    readonly name: string;
    readonly path: string;
    readonly writable: boolean;
  }[];
  readonly truncated: boolean;
  readonly hiddenSkipped: number;
}

/**
 * Every typed kind the contract defines, plus the one bucket the client owns:
 * `unknown` for a transport failure or a refusal this build does not know.
 */
export type WorkspaceBrowseFailure =
  | "workspace_list_invalid_path"
  | "workspace_list_not_found"
  | "workspace_list_not_a_directory"
  | "workspace_list_permission_denied"
  | "workspace_list_root_escape"
  | "workspace_create_invalid_name"
  | "workspace_create_parent_not_found"
  | "workspace_create_parent_not_a_directory"
  | "workspace_create_permission_denied"
  | "workspace_create_root_escape"
  | "workspace_create_exists_not_directory"
  | "profile_local_unsupported"
  | "unknown";

/** The adapter never throws: the component only ever sees typed outcomes. */
export type WorkspaceBrowseOutcome<Value> =
  | { readonly status: "ok"; readonly value: Value }
  | { readonly status: "failed"; readonly failure: WorkspaceBrowseFailure };

export interface WorkspaceBrowseAdapter {
  /** null asks about the server's own working directory. */
  list: (
    path: string | null,
  ) => Promise<WorkspaceBrowseOutcome<WorkspaceFolderListing>>;
  create: (
    parent: string,
    name: string,
  ) => Promise<WorkspaceBrowseOutcome<{ canonicalPath: string }>>;
}

export interface WorkspaceBrowseCopy {
  /** English source string; the caller translates it. */
  readonly message: string;
  /** What to do next. Always present — a dead end is never acceptable copy. */
  readonly nextStep: string;
}

const FAILURE_COPY: Readonly<
  Record<WorkspaceBrowseFailure, WorkspaceBrowseCopy>
> = {
  workspace_list_invalid_path: {
    message: "That path can't be browsed.",
    nextStep: "Browse from the server's working directory instead.",
  },
  workspace_list_not_found: {
    message: "That folder is no longer on the server.",
    nextStep: "Go up one level and pick a folder that still exists.",
  },
  workspace_list_not_a_directory: {
    message: "That path is a file, not a folder.",
    nextStep: "Go up one level and pick a folder.",
  },
  workspace_list_permission_denied: {
    message: "Octos can't open that folder.",
    nextStep: "Pick a folder the Octos server is allowed to read.",
  },
  workspace_list_root_escape: {
    message: "That folder is outside the area Octos may browse.",
    nextStep: "Pick a folder inside your own projects instead.",
  },
  workspace_create_invalid_name: {
    message: "The server rejected that folder name.",
    nextStep: "Use a single name without slashes, up to 255 bytes.",
  },
  workspace_create_parent_not_found: {
    message: "The folder you're creating in is no longer on the server.",
    nextStep: "Go up one level and try again.",
  },
  workspace_create_parent_not_a_directory: {
    message: "The place you're creating in is a file, not a folder.",
    nextStep: "Go up one level and pick a folder.",
  },
  workspace_create_permission_denied: {
    message: "Octos can't create a folder here.",
    nextStep: "Pick a folder the Octos server is allowed to write to.",
  },
  workspace_create_root_escape: {
    message: "That location is outside the area Octos may write to.",
    nextStep: "Create the folder inside your own projects instead.",
  },
  workspace_create_exists_not_directory: {
    message: "A file of that name is already here.",
    nextStep: "Choose a different folder name.",
  },
  profile_local_unsupported: {
    message: "This server doesn't offer folder browsing.",
    nextStep: "Type the workspace path instead.",
  },
  unknown: {
    message: "Couldn't reach the server's folders.",
    nextStep: "Try again, or type the workspace path instead.",
  },
};

export function workspaceBrowseCopy(
  failure: WorkspaceBrowseFailure,
): WorkspaceBrowseCopy {
  return FAILURE_COPY[failure] ?? FAILURE_COPY.unknown;
}

/** Client pre-validation of §2's name rules; the server stays the authority. */
export type WorkspaceFolderNameProblem =
  | "empty"
  | "separator"
  | "relative"
  | "control"
  | "surrounding_whitespace"
  | "too_long";

const NAME_PROBLEM_COPY: Readonly<Record<WorkspaceFolderNameProblem, string>> =
  {
    empty: "Enter a name for the new folder.",
    separator: "A folder name can't contain a slash. Enter one name only.",
    relative: "Enter a folder name other than . or ..",
    control: "A folder name can't contain control characters. Use plain text.",
    surrounding_whitespace:
      "A folder name can't start or end with a space. Trim it.",
    too_long: "That folder name is too long. Use up to 255 bytes.",
  };

export function workspaceFolderNameCopy(
  problem: WorkspaceFolderNameProblem,
): string {
  return NAME_PROBLEM_COPY[problem] ?? NAME_PROBLEM_COPY.empty;
}

/**
 * Mirrors the rules §2 says the server enforces: exactly one path component —
 * no `/`, no `\`, not `.`, not `..`, no NUL or control characters, 1..=255
 * bytes, and it must not start or end with whitespace.
 */
export function validateWorkspaceFolderName(
  name: string,
): WorkspaceFolderNameProblem | null {
  if (name.length === 0) return "empty";
  if (name.includes("/") || name.includes("\\")) return "separator";
  if (name === "." || name === "..") return "relative";
  for (const character of name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return "control";
  }
  if (name !== name.trim()) return "surrounding_whitespace";
  if (name.trim().length === 0) return "empty";
  if (utf8Bytes(name) > WORKSPACE_FOLDER_NAME_MAX_BYTES) return "too_long";
  return null;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Where browsing opens: the server's working directory (null) when the path
 * box is empty, otherwise the typed path.
 */
export function workspaceBrowseOpenPath(typedPath: string): string | null {
  const trimmed = typedPath.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Parent of an absolute server path, or null at a root. Only a client-side
 * hint for finding a listable ancestor — a listing's own `parent_path` is
 * authoritative for the Up affordance.
 */
export function parentWorkspacePath(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed || trimmed === "/" || trimmed === "~") return null;
  const normalized = trimmed.replace(/\/+$/u, "");
  if (!normalized || normalized === "~") return null;
  const cut = normalized.lastIndexOf("/");
  if (cut < 0) return null;
  if (cut === 0) return "/";
  return normalized.slice(0, cut);
}

/** Join a listing's canonical path with one validated child component. */
export function joinWorkspacePath(parent: string, name: string): string {
  const base = parent.replace(/\/+$/u, "");
  return base ? `${base}/${name}` : `/${name}`;
}

const RESOLVABLE_ON_OPEN: ReadonlySet<WorkspaceBrowseFailure> = new Set([
  "workspace_list_invalid_path",
  "workspace_list_not_found",
  "workspace_list_not_a_directory",
]);

/**
 * §Client behaviour: browsing opens on "the typed path's nearest existing
 * ancestor". Returns the next candidate to try, or undefined to stop and show
 * the failure. `null` means the server's own working directory (the last
 * resort, which the server always resolves).
 */
export function workspaceBrowseRetryPath(
  attempted: string | null,
  failure: WorkspaceBrowseFailure,
): string | null | undefined {
  if (attempted === null || !RESOLVABLE_ON_OPEN.has(failure)) return undefined;
  return parentWorkspacePath(attempted);
}

export interface WorkspaceListingNotice {
  readonly source: string;
  readonly params?: Readonly<Record<string, string | number>>;
}

/** `truncated` and `hidden_skipped` are reported honestly, never swallowed. */
export function workspaceListingNotices(
  listing: WorkspaceFolderListing,
): readonly WorkspaceListingNotice[] {
  const notices: WorkspaceListingNotice[] = [];
  if (listing.truncated) {
    notices.push({
      source: "Only the first {value0} folders are shown.",
      params: { value0: listing.entries.length },
    });
  }
  if (listing.hiddenSkipped > 0) {
    notices.push({
      source: "{value0} hidden folders aren't shown.",
      params: { value0: listing.hiddenSkipped },
    });
  }
  return notices;
}

export interface WorkspaceBrowseState {
  readonly loading: boolean;
  readonly listing: WorkspaceFolderListing | null;
  readonly failure: WorkspaceBrowseFailure | null;
  readonly newFolderOpen: boolean;
  readonly newFolderName: string;
  readonly nameProblem: WorkspaceFolderNameProblem | null;
  readonly creating: boolean;
}

export const IDLE_WORKSPACE_BROWSE: WorkspaceBrowseState = {
  loading: false,
  listing: null,
  failure: null,
  newFolderOpen: false,
  newFolderName: "",
  nameProblem: null,
  creating: false,
};

export type WorkspaceBrowseAction =
  | { type: "reset" }
  | { type: "loading" }
  | { type: "listed"; listing: WorkspaceFolderListing }
  | { type: "failed"; failure: WorkspaceBrowseFailure }
  | { type: "new-folder-open" }
  | { type: "new-folder-cancel" }
  | { type: "new-folder-name"; name: string }
  | { type: "create" }
  | { type: "created" }
  | { type: "create-failed"; failure: WorkspaceBrowseFailure };

/**
 * A failed step never destroys the folder the operator is standing in: the
 * last good listing stays on screen beside the refusal so Up and the other
 * subfolders remain reachable.
 */
export function workspaceBrowseReducer(
  state: WorkspaceBrowseState,
  action: WorkspaceBrowseAction,
): WorkspaceBrowseState {
  switch (action.type) {
    case "reset":
      return IDLE_WORKSPACE_BROWSE;
    case "loading":
      return { ...state, loading: true, failure: null, nameProblem: null };
    case "listed":
      return {
        ...state,
        loading: false,
        listing: action.listing,
        failure: null,
        newFolderOpen: false,
        newFolderName: "",
        nameProblem: null,
        creating: false,
      };
    case "failed":
      return { ...state, loading: false, failure: action.failure };
    case "new-folder-open":
      return {
        ...state,
        newFolderOpen: true,
        newFolderName: "",
        nameProblem: null,
        failure: null,
      };
    case "new-folder-cancel":
      return {
        ...state,
        newFolderOpen: false,
        newFolderName: "",
        nameProblem: null,
        creating: false,
      };
    case "new-folder-name":
      return { ...state, newFolderName: action.name, nameProblem: null };
    case "create": {
      const problem = validateWorkspaceFolderName(state.newFolderName);
      return problem
        ? { ...state, nameProblem: problem, creating: false }
        : { ...state, nameProblem: null, failure: null, creating: true };
    }
    case "created":
      return {
        ...state,
        creating: false,
        newFolderOpen: false,
        newFolderName: "",
      };
    case "create-failed":
      return { ...state, creating: false, failure: action.failure };
    default:
      return state;
  }
}

/** Whether the New folder affordance may be offered for the current listing. */
export function canCreateWorkspaceFolder(
  listing: WorkspaceFolderListing | null,
): boolean {
  return Boolean(listing?.writable);
}
