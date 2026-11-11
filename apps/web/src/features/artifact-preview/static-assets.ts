/** Hash-named build directories whose files keep their own names (vite.config.ts). */
declare const __OCTOSCODE_STATIC_ASSETS__: { pdfjs: string; ocr: string };

export function staticAssetDirectory(group: "pdfjs" | "ocr"): string {
  return new URL(
    `${import.meta.env.BASE_URL}${__OCTOSCODE_STATIC_ASSETS__[group]}`,
    window.location.href,
  ).href;
}
