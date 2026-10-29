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
