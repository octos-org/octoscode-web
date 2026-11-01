/**
 * The phone overview lives at `?view=remote` on the same origin: a bookmark
 * (or, later, a QR code) carries only the HTTPS address, never a credential.
 * Session deep links (`?s=`) keep working alongside it.
 */
export const REMOTE_VIEW_PARAM = "view";
export const REMOTE_VIEW_VALUE = "remote";

export function isRemoteViewUrl(href: string): boolean {
  try {
    return (
      new URL(href).searchParams.get(REMOTE_VIEW_PARAM) === REMOTE_VIEW_VALUE
    );
  } catch {
    return false;
  }
}

export function withRemoteView(href: string, on: boolean): string {
  const url = new URL(href);
  if (on) url.searchParams.set(REMOTE_VIEW_PARAM, REMOTE_VIEW_VALUE);
  else url.searchParams.delete(REMOTE_VIEW_PARAM);
  return url.toString();
}
