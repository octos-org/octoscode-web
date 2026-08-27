export function freshWebSessionId(
  profileId: string,
  randomUuid: () => string = () => crypto.randomUUID(),
): string {
  const handle = `web-${randomUuid()}`;
  const profile = profileId.trim();
  return profile ? `${profile}:api:${handle}` : handle;
}
