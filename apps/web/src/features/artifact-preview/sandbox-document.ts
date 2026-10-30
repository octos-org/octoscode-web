/**
 * The frame inherits the application's strict CSP. This second policy keeps
 * untrusted documents offline even if the host policy changes later. Scripts
 * are also disabled by the iframe's empty sandbox token list.
 */
export function sandboxDocument(source: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'none'; script-src 'none'; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'"></head><body>${source}</body></html>`;
}
