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

export { createSavedSessionUrl } from "./create-saved-session-url.ts";
