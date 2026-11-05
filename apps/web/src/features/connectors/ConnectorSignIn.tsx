import { useId, useState } from "react";
import type {
  OctosUiClient,
  UiProtocolCapabilities,
} from "@octos-org/octoscode-client/protocol";
import { useUiText, type UiText } from "../preferences/ui-text.tsx";
import styles from "../settings-lists/SettingsLists.module.css";
import local from "./ConnectorsSettingsContent.module.css";
import {
  cancelConnectorOAuth,
  completeConnectorOAuthManually,
  revokeConnectorOAuth,
  startConnectorOAuth,
  type ConnectorOAuthState,
  type OAuthFailure,
  type SignInWindow,
} from "./connector-oauth.ts";

interface ConnectorSignInProps {
  client: OctosUiClient;
  profileId: string;
  sessionId: string;
  capabilities: UiProtocolCapabilities;
  connectorId: string;
  connectorName: string;
  state: ConnectorOAuthState | undefined;
  /** The server's error says this connector needs signing in. */
  needsSignIn: boolean;
  /** That error as the server wrote it, kept under the details. */
  serverError?: string | undefined;
  /** A server reply said it signs in with OAuth, so there may be a sign-in to revoke. */
  usesOAuth: boolean;
  /** Management is off, or the page is busy with another change. */
  locked: boolean;
}

/** The app must sit at the origin's root for Core's fixed return path to reach it. */
const CALLBACK_SERVED = import.meta.env.BASE_URL === "/";

function failureText(
  reason: OAuthFailure,
  detail: string | undefined,
  t: UiText,
) {
  switch (reason) {
    case "https_required":
      return t("Only connectors with an https address can sign in.");
    case "no_oauth":
      return t("This connector's service doesn't offer sign-in (OAuth).");
    case "denied":
      return t("Sign-in didn't finish: the service answered “{reason}”.", {
        reason: detail ?? "",
      });
    case "exchange_failed":
      return t(
        "Sign-in didn't finish: the service refused it when Octos exchanged it.",
      );
    case "lost":
      return t(
        "This sign-in is no longer waiting on the server (cancelled, or the server restarted). Sign in again.",
      );
    case "expired":
      return t("This sign-in expired after 10 minutes. Sign in again.");
    case "permission":
      return t(
        "You do not have permission to manage this profile's connectors.",
      );
    default:
      return t("Sign-in didn't finish.");
  }
}

function stateText(state: ConnectorOAuthState | undefined, t: UiText) {
  switch (state?.kind) {
    case "starting":
      return t("Getting the sign-in page…");
    case "completing":
      return t("Finishing sign-in…");
    case "authorized":
      return state.takesEffect === "restart"
        ? t("Signed in. Takes effect after the server restarts.")
        : state.takesEffect === "unknown"
          ? t("Signed in. Not in effect yet.")
          : t("Signed in.");
    case "revoking":
      return t("Revoking sign-in…");
    case "revoked":
      return state.takesEffect === "restart"
        ? t("Sign-in revoked. The server keeps using it until it restarts.")
        : t("Sign-in revoked. Sign in again to use this connector.");
    case "cancelled":
      return t(
        "Sign-in cancelled. Nothing was saved. You can close the sign-in window.",
      );
    default:
      return null;
  }
}

/** Opened in the click itself: a window opened after an await is blocked. */
function openSignInWindow(placeholder: string): SignInWindow | null {
  const opened = window.open("", "_blank", "popup,width=520,height=720");
  if (!opened) return null;
  // The provider's page must not reach back into this one.
  opened.opener = null;
  try {
    opened.document.title = placeholder;
    opened.document.body.textContent = placeholder;
  } catch {
    // Not writable: the window still works, it is only blank for a moment.
  }
  return opened;
}

export function ConnectorSignIn({
  client,
  profileId,
  sessionId,
  capabilities,
  connectorId,
  connectorName,
  state,
  needsSignIn,
  serverError,
  usesOAuth,
  locked,
}: ConnectorSignInProps) {
  const t = useUiText();
  const addressId = useId();
  const [address, setAddress] = useState("");
  const [addressError, setAddressError] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const busy =
    state?.kind === "starting" ||
    state?.kind === "completing" ||
    state?.kind === "revoking";
  const waiting = state?.kind === "waiting" ? state : null;
  const commands = () =>
    client.inventoryCommands(sessionId, profileId, capabilities);

  function signIn() {
    setConfirmRevoke(false);
    setAddress("");
    setAddressError(false);
    void startConnectorOAuth({
      connection: client,
      profileId,
      connectorId,
      commands,
      origin: window.location.origin,
      callbackServed: CALLBACK_SERVED,
      window: openSignInWindow(t("Opening the sign-in page…")),
      serverNow: async () => {
        // The web origin IS the server here; its Date header is the only
        // wall clock we should compare the server's expiry with (T-0371).
        try {
          const response = await fetch(window.location.origin, {
            method: "HEAD",
            cache: "no-store",
          });
          const parsed = Date.parse(response.headers.get("date") ?? "");
          return Number.isFinite(parsed) ? parsed : null;
        } catch {
          return null;
        }
      },
    });
  }

  function revoke() {
    setConfirmRevoke(false);
    void revokeConnectorOAuth(client, profileId, connectorId, commands);
  }

  const text =
    state?.kind === "failed"
      ? failureText(state.reason, state.detail, t)
      : waiting
        ? waiting.manual
          ? t(
              "This server takes the sign-in back by hand: after you allow access, the window stops on a page that doesn't load. Copy that page's full address here.",
            )
          : waiting.windowBlocked
            ? t(
                "The browser blocked the sign-in window. Open it with the link below.",
              )
            : t(
                "Finish signing in in the window that opened. This page updates by itself when you're done.",
              )
        : (stateText(state, t) ??
          (needsSignIn ? t("This connector needs you to sign in.") : null));
  const signedIn = usesOAuth || state?.kind === "authorized";
  // One place for what the server said: the sign-in's own error, then the connector's.
  const details = [
    state?.kind === "failed" &&
    state.reason !== "denied" &&
    state.reason !== "expired"
      ? state.detail
      : undefined,
    serverError?.slice(0, 512),
  ].filter((detail): detail is string => Boolean(detail));
  return (
    <div className={local.signIn} data-sign-in={state?.kind ?? "idle"}>
      {text ? (
        <p
          className={state?.kind === "failed" ? styles.error : local.savedState}
          role="status"
        >
          {text}
        </p>
      ) : null}
      {details.length ? (
        <details>
          <summary>{t("Technical details")}</summary>
          {details.map((detail) => (
            <code key={detail}>{detail}</code>
          ))}
        </details>
      ) : null}
      {waiting?.manual ? (
        <form
          className={local.signInPaste}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const ok = completeConnectorOAuthManually(
              client,
              profileId,
              connectorId,
              address,
            );
            setAddressError(!ok);
            if (ok) setAddress("");
          }}
        >
          <label className={local.field} htmlFor={addressId}>
            <span>{t("Address after signing in")}</span>
          </label>
          <input
            id={addressId}
            type="url"
            value={address}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={addressError}
            onChange={(event) => {
              setAddress(event.target.value);
              setAddressError(false);
            }}
          />
          {addressError ? (
            <p className={styles.error} role="alert">
              {t(
                "That isn't a web address. Copy the full address from the sign-in window.",
              )}
            </p>
          ) : null}
          <div className={local.actions}>
            <button
              type="submit"
              className={local.primary}
              disabled={!address.trim()}
            >
              {t("Finish signing in")}
            </button>
          </div>
        </form>
      ) : null}
      <div className={local.actions}>
        {waiting ? (
          <>
            <a
              className={local.linkButton}
              href={waiting.authorizationUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {waiting.windowBlocked && !waiting.manual
                ? t("Open the sign-in page")
                : t("Open the sign-in page again")}
            </a>
            <button
              type="button"
              onClick={() =>
                void cancelConnectorOAuth(client, profileId, connectorId)
              }
            >
              {t("Cancel sign-in")}
            </button>
          </>
        ) : (
          <button
            type="button"
            className={needsSignIn && !signedIn ? local.primary : undefined}
            disabled={locked || busy}
            onClick={signIn}
          >
            {state?.kind === "starting"
              ? t("Getting the sign-in page…")
              : signedIn ||
                  state?.kind === "failed" ||
                  state?.kind === "revoked"
                ? t("Sign in again")
                : t("Sign in")}
          </button>
        )}
        {signedIn && !waiting ? (
          <button
            type="button"
            className={local.danger}
            disabled={locked || busy}
            onClick={() => setConfirmRevoke(true)}
          >
            {state?.kind === "revoking"
              ? t("Revoking sign-in…")
              : t("Revoke sign-in")}
          </button>
        ) : null}
      </div>
      {confirmRevoke ? (
        <div className={local.confirm} role="alert">
          <p>
            {t(
              "Revoke the sign-in for {name}? It stops working until you sign in again.",
              { name: connectorName },
            )}
          </p>
          <div className={local.actions}>
            <button
              type="button"
              className={local.danger}
              disabled={locked || busy}
              onClick={revoke}
            >
              {t("Confirm revoke")}
            </button>
            <button type="button" onClick={() => setConfirmRevoke(false)}>
              {t("Cancel")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
