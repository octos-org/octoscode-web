/** The entry script a document loads, resolved against `base`. */
function entryScript(page: Document, base: string): string | null {
  const src = page
    .querySelector<HTMLScriptElement>('script[type="module"][src]')
    ?.getAttribute("src");
  return src ? new URL(src, base).href : null;
}

/**
 * Whether the server now serves another build than this page runs: its
 * index.html, which is never cached, names a different entry script. A
 * deployment replaces the hashed chunks an open window would load next.
 * Anything unknown answers false.
 */
export async function servedBuildChanged(): Promise<boolean> {
  const running = entryScript(document, document.baseURI);
  const index = new URL(
    `${import.meta.env.BASE_URL}index.html`,
    window.location.href,
  );
  const response = await fetch(index, { cache: "no-store" });
  if (!running || !response.ok) return false;
  const served = entryScript(
    new DOMParser().parseFromString(await response.text(), "text/html"),
    index.href,
  );
  return served !== null && served !== running;
}
