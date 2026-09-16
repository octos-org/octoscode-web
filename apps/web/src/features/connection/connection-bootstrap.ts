/**
 * The pre-connection facts the first paint needs: where to point by default,
 * whether this tab should start talking to a server before the operator says
 * anything, and the one warning that outlives a failed cleanup.
 *
 * These live outside App.tsx so the connect screen can be rendered — and this
 * decision taken — without loading the product shell.
 */
import type { ConnectionDraft } from "./ConnectionPanel.tsx";

export function defaultEndpoint(): string {
  const configured = import.meta.env.VITE_OCTOS_DEFAULT_ENDPOINT?.trim();
  if (configured) return configured;
  return window.location.origin;
}

export const initialConnection: ConnectionDraft = {
  endpoint: defaultEndpoint(),
  token: "",
  sessionId: "coding:local:main",
  profileId: "",
  cwd: "",
};

export const STORAGE_CLEAR_WARNING =
  "Saved data could not be cleared. Old sign-in details or drafts may return after reload. Clear this site’s stored data in browser settings, or retry Forget saved connection.";

export interface AutoStartInput {
  /** A pairing link drives its own connect; nothing else may race it. */
  readonly pairingLink: boolean;
  /** This tab was already connected (sessionStorage auto-connect). */
  readonly restoreConnection: boolean;
  /** This device remembers a token for the loaded origin. */
  readonly rememberedConnect: boolean;
  readonly endpoint: string;
  readonly token: string;
  readonly sessionId: string;
}

/**
 * What an unattended first render would do on its own: `restore` re-opens the
 * tab's previous Session, `connect` authenticates with a remembered token, and
 * null means the operator has to press Connect. The entry uses it to decide
 * whether to load the product shell before the first paint; the shell uses the
 * same answer to decide what to send, so the two can never disagree.
 */
export function autoStartKind(
  input: AutoStartInput,
): "restore" | "connect" | null {
  if (input.pairingLink) return null;
  if (!input.restoreConnection && !input.rememberedConnect) return null;
  if (!input.restoreConnection) {
    return input.endpoint.trim() && input.token.trim() ? "connect" : null;
  }
  return input.endpoint.trim() && input.sessionId.trim() ? "restore" : null;
}
