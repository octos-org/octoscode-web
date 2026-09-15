import { knownSessionKey } from "../session/known-session-registry.ts";
import {
  parseSavedSessionReference,
  type SavedSessionReference,
} from "./saved-session-link.ts";

/** Build an explicit navigation link from a confirmed session/open reference. */
export function createSavedSessionUrl(
  pageUrl: string,
  reference: SavedSessionReference,
): string {
  const key = knownSessionKey(reference);
  if (!parseSavedSessionReference(key)) {
    throw new Error("Cannot link to an incomplete session reference.");
  }
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Session links require a Web application address.");
  }
  url.username = "";
  url.password = "";
  // Connection credentials never belong in a link copied from the app. Keep
  // unrelated application query parameters, but remove credential parameters.
  const credentialParameters = [...url.searchParams.keys()].filter(
    (parameter) =>
      /^(?:token|auth|auth_token|access_token|api_key|apikey)$/i.test(
        parameter,
      ),
  );
  for (const parameter of credentialParameters) {
    url.searchParams.delete(parameter);
  }
  url.searchParams.set("s", key);
  return url.href;
}
