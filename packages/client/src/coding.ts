import { isRecord } from "./rpc.ts";
import type {
  DiffPreview,
  DiffPreviewFile,
  DiffPreviewGetResult,
  DiffPreviewHunk,
  DiffPreviewLine,
  PermissionNetworkPolicy,
  PermissionProfileListResult,
  PermissionProfileMode,
  PermissionProfileSelection,
  PermissionProfileSetResult,
} from "./types.ts";

const PREVIEW_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePermissionProfileListResult(
  value: unknown,
): PermissionProfileListResult | null {
  if (!isRecord(value) || typeof value.session_id !== "string") return null;
  const current = parsePermissionProfileSelection(value.current);
  const profiles = value.profiles ?? [];
  if (!current || !Array.isArray(profiles)) return null;
  const parsedProfiles = profiles.map(parsePermissionProfileSelection);
  if (parsedProfiles.some((profile) => profile === null)) return null;
  return {
    session_id: value.session_id,
    current,
    profiles: parsedProfiles as PermissionProfileSelection[],
  };
}

export function parsePermissionProfileSetResult(
  value: unknown,
): PermissionProfileSetResult | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    typeof value.applied !== "boolean"
  ) {
    return null;
  }
  const current = parsePermissionProfileSelection(value.current);
  return current
    ? { session_id: value.session_id, current, applied: value.applied }
    : null;
}

export function parseDiffPreviewGetResult(
  value: unknown,
): DiffPreviewGetResult | null {
  if (
    !isRecord(value) ||
    typeof value.status !== "string" ||
    !value.status ||
    typeof value.source !== "string" ||
    !value.source
  ) {
    return null;
  }
  const preview = parseDiffPreview(value.preview);
  return preview
    ? { status: value.status, source: value.source, preview }
    : null;
}

export function isPreviewId(value: unknown): value is string {
  return typeof value === "string" && PREVIEW_ID.test(value);
}

function parsePermissionProfileSelection(
  value: unknown,
): PermissionProfileSelection | null {
  if (!isRecord(value)) return null;
  const mode = normalizePermissionMode(value.mode);
  const network = normalizeNetworkPolicy(value.network);
  return mode && network ? { mode, network } : null;
}

function normalizePermissionMode(value: unknown): PermissionProfileMode | null {
  switch (value) {
    case "read_only":
    case "read-only":
      return "read_only";
    case "workspace_write":
    case "workspace-write":
      return "workspace_write";
    case "danger_full_access":
    case "danger-full-access":
      return "danger_full_access";
    default:
      return null;
  }
}

function normalizeNetworkPolicy(
  value: unknown,
): PermissionNetworkPolicy | null {
  return value === "allow" || value === "deny" ? value : null;
}

function parseDiffPreview(value: unknown): DiffPreview | null {
  if (
    !isRecord(value) ||
    typeof value.session_id !== "string" ||
    !isPreviewId(value.preview_id) ||
    (value.title !== undefined && typeof value.title !== "string")
  ) {
    return null;
  }
  const files = value.files ?? [];
  if (!Array.isArray(files)) return null;
  const parsedFiles = files.map(parseDiffFile);
  if (parsedFiles.some((file) => file === null)) return null;
  return {
    session_id: value.session_id,
    preview_id: value.preview_id,
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    files: parsedFiles as DiffPreviewFile[],
  };
}

function parseDiffFile(value: unknown): DiffPreviewFile | null {
  if (
    !isRecord(value) ||
    typeof value.path !== "string" ||
    typeof value.status !== "string" ||
    !value.status ||
    (value.old_path !== undefined && typeof value.old_path !== "string")
  ) {
    return null;
  }
  const hunks = value.hunks ?? [];
  if (!Array.isArray(hunks)) return null;
  const parsedHunks = hunks.map(parseDiffHunk);
  if (parsedHunks.some((hunk) => hunk === null)) return null;
  return {
    path: value.path,
    status: value.status,
    ...(typeof value.old_path === "string" ? { old_path: value.old_path } : {}),
    hunks: parsedHunks as DiffPreviewHunk[],
  };
}

function parseDiffHunk(value: unknown): DiffPreviewHunk | null {
  if (!isRecord(value) || typeof value.header !== "string") return null;
  const lines = value.lines ?? [];
  if (!Array.isArray(lines)) return null;
  const parsedLines = lines.map(parseDiffLine);
  if (parsedLines.some((line) => line === null)) return null;
  return { header: value.header, lines: parsedLines as DiffPreviewLine[] };
}

function parseDiffLine(value: unknown): DiffPreviewLine | null {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    !value.kind ||
    typeof value.content !== "string" ||
    !isOptionalU32(value.old_line) ||
    !isOptionalU32(value.new_line)
  ) {
    return null;
  }
  return {
    kind: value.kind,
    content: value.content,
    ...(typeof value.old_line === "number" ? { old_line: value.old_line } : {}),
    ...(typeof value.new_line === "number" ? { new_line: value.new_line } : {}),
  };
}

function isOptionalU32(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isInteger(value) &&
      value >= 0 &&
      value <= 4_294_967_295)
  );
}
