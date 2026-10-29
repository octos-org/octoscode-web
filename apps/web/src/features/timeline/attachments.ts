import { workspaceRelativeArtifactPath } from "./session-file-read.ts";

const PREVIEWABLE_IMAGE = /\.(png|jpe?g|gif|webp)$/i;

/**
 * The name to show (and save as) for a delivered file reference: the last
 * path segment of a server path, or an upload handle's display name.
 */
export function attachmentName(reference: string): string {
  return (
    reference.split(/[\\/]/).filter(Boolean).at(-1) ?? (reference || "file")
  );
}

export interface AttachmentFileMetadata {
  filename: string;
  path: string;
  size_bytes: number;
}

/** Match a full workspace-relative path, never a basename or workspace root name. */
export function uniqueWorkspaceAttachmentFile<T extends AttachmentFileMetadata>(
  reference: string,
  workspaceRoot: string,
  files: readonly T[],
): T | null {
  if (reference.startsWith("pf/")) {
    const exact = files.filter((file) => file.path === reference);
    return exact.length === 1 ? exact[0]! : null;
  }
  const relative = workspaceRelativeArtifactPath(reference, workspaceRoot);
  if (!relative) return null;
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const canonicalRoot = /(?:^|\/)(users\/[^/]+\/workspace)$/.exec(
    normalizedRoot,
  )?.[1];
  if (!canonicalRoot) return null;
  const expected = `${canonicalRoot}/${relative}`;
  const matches = files.filter(
    (file) => profileHandlePath(file.path)?.replace(/\\/g, "/") === expected,
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** Match a canonical profile handle by its full workspace-relative path. */
export function uniqueProfileFileForWorkspacePath<
  T extends AttachmentFileMetadata,
>(workspacePath: string, files: readonly T[]): T | null {
  const matches = files.filter((file) => {
    const decoded = profileHandlePath(file.path)?.replace(/\\/g, "/");
    return (
      decoded === workspacePath ||
      (decoded !== undefined && decoded.endsWith(`/${workspacePath}`))
    );
  });
  return matches.length === 1 ? matches[0]! : null;
}

function profileHandlePath(value: string): string | null {
  if (!value.startsWith("pf/")) return null;
  const encoded = value.split("/")[1];
  if (!encoded) return null;
  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    return new TextDecoder().decode(
      Uint8Array.from(atob(base64), (character) => character.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

export function formatAttachmentSize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: unit === 0 ? 0 : 1,
  }).format(value)} ${units[unit]}`;
}

/** Keep the type suffix visible when the identifying stem needs truncation. */
export function attachmentNameParts(reference: string): {
  stem: string;
  extension: string;
} {
  const name = attachmentName(reference);
  const dot = name.lastIndexOf(".");
  return dot > 0
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: "" };
}

/**
 * Raster images may load beside the message without a click. SVG instead uses
 * the explicit, offline-sandboxed artifact preview.
 */
export function isPreviewableImage(name: string): boolean {
  return PREVIEWABLE_IMAGE.test(name);
}
