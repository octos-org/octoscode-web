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

/** Exact paths win; a basename fallback is allowed only when unambiguous. */
export function uniqueAttachmentFile<T extends AttachmentFileMetadata>(
  reference: string,
  files: readonly T[],
): T | null {
  const exact = files.filter((file) => file.path === reference);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const compatible = files.filter((file) => {
    const decoded = profileHandlePath(file.path);
    return decoded !== null && pathSuffix(decoded) === pathSuffix(reference);
  });
  if (compatible.length === 1) return compatible[0]!;
  if (
    compatible.length > 1 ||
    reference.includes("/") ||
    reference.includes("\\")
  )
    return null;
  const name = attachmentName(reference);
  const matches = files.filter((file) => file.filename === name);
  return matches.length === 1 ? matches[0]! : null;
}

function pathSuffix(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).slice(-2).join("/");
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
