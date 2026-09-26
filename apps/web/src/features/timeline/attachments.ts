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

/**
 * Raster images shown inline. SVG is left out: a preview of an untrusted
 * document is not worth the scrutiny its markup would need.
 */
export function isPreviewableImage(name: string): boolean {
  return PREVIEWABLE_IMAGE.test(name);
}
