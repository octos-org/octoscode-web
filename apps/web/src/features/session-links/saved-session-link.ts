import { knownSessionKey } from "../session/known-session-registry.ts";

export interface SavedSessionReference {
  workspaceRoot: string;
  profileId: string;
  sessionId: string;
}

const LIMITS = [4_096, 512, 1_024] as const;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;

/** Decode routing intent only. A valid link is never proof a session exists. */
export function parseSavedSessionReference(
  value: string | null,
): SavedSessionReference | null {
  if (!value || value.length > 12_000) return null;
  let tuple: unknown;
  try {
    tuple = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(tuple) || tuple.length !== 3) return null;
  if (
    tuple.some(
      (part, index) =>
        typeof part !== "string" ||
        !part ||
        part.trim() !== part ||
        part.length > LIMITS[index]! ||
        CONTROL_CHARACTERS.test(part),
    )
  ) {
    return null;
  }
  const [workspaceRoot, profileId, sessionId] = tuple as [
    string,
    string,
    string,
  ];
  // Server paths may be POSIX, a Windows drive, or a Windows UNC share.
  if (!/^(?:\/|[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(workspaceRoot)) {
    return null;
  }
  return { workspaceRoot, profileId, sessionId };
}

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
