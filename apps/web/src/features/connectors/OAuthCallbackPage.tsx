import { useEffect, useState } from "react";
import { OctopusLogo } from "../../ui/OctopusLogo.tsx";
import { useUiText } from "../preferences/ui-text.tsx";
import {
  deliverOAuthCallback,
  type CallbackDelivery,
} from "./connector-oauth.ts";

/**
 * Where a connector's sign-in provider sends the person back. It hands the
 * return address to the Octoscode page that started the sign-in and closes;
 * the address was already taken off this page before it rendered.
 */
export function OAuthCallbackPage({ href }: { href: string }) {
  const t = useUiText();
  const [delivery, setDelivery] = useState<CallbackDelivery | null>(null);
  useEffect(() => {
    let live = true;
    void deliverOAuthCallback(href).then((result) => {
      if (!live) return;
      setDelivery(result);
      if (result === "received") window.setTimeout(() => window.close(), 1_200);
    });
    return () => {
      live = false;
    };
  }, [href]);
  const [title, body] =
    delivery === "received"
      ? [
          t("Sign-in handed back"),
          t("Octoscode is finishing it. You can close this window."),
        ]
      : delivery === "unclaimed"
        ? [
            t("No Octoscode page is waiting for this sign-in"),
            t(
              "The page may have been refreshed, or the sign-in was cancelled. Go back to Octoscode and choose Sign in on the connector again.",
            ),
          ]
        : delivery === "unsupported"
          ? [
              t("This browser can't hand the sign-in back"),
              t(
                "Go back to Octoscode and sign in again from a current version of Chrome, Edge, Firefox or Safari.",
              ),
            ]
          : [t("Handing the sign-in back to Octoscode…"), ""];
  return (
    <main className="fatal-shell">
      <section className="fatal-card" aria-live="polite">
        <OctopusLogo className="fatal-brand-logo" size={32} />
        <h1>{title}</h1>
        {body ? <p>{body}</p> : null}
      </section>
    </main>
  );
}
