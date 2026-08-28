const WEB_SESSION_PREFIX = "web-";

/**
 * Create a launch intent that is deliberately profile-neutral.
 *
 * Workspace launch resolution owns the profile choice. Binding the id before
 * that decision would make a legitimate cross-profile choice fail Core's
 * session-scope validation.
 */
export function freshWebSessionId(
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  return `${WEB_SESSION_PREFIX}${randomUuid()}`;
}

/**
 * Turn a fresh Web launch intent into a profile-routable compatibility id.
 *
 * Core accepts a raw `web-*` id during session/open, but follow-up methods such
 * as session/hydrate and session/status/read route from the id alone. The
 * resolved profile therefore has to be embedded exactly once before open.
 * Core currently echoes this id rather than canonicalizing it; existing
 * server-authored ids must therefore be returned unchanged.
 */
export function bindWebSessionIdToProfile(
  sessionId: string,
  profileId: string,
): string {
  const id = sessionId.trim();
  const profile = profileId.trim();
  if (!id.startsWith(WEB_SESSION_PREFIX) || !profile) return id;
  return `${profile}:api:${id}`;
}
