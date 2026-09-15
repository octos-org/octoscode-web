import { isRecord } from "./rpc.ts";
import { isNonEmptyString, isNonNegativeInteger } from "./wire-decoders.ts";
import type {
  LaunchResolveResult,
  SessionDeleteResult,
  SessionFileInfo,
  SessionFilesListResult,
  SessionListEntry,
  SessionListResult,
} from "./types.ts";
const LAUNCH_DECISIONS = new Set([
  "resume",
  "activate",
  "cross_profile",
  "no_profile",
]);
const MAX_LAUNCH_PROFILE_ID_LENGTH = 64;
const MAX_LAUNCH_EXISTING_PROFILES = 256;

export function parseLaunchResolveResult(
  value: unknown,
): LaunchResolveResult | null {
  if (
    !isRecord(value) ||
    typeof value.decision !== "string" ||
    !LAUNCH_DECISIONS.has(value.decision) ||
    (value.resolved_profile !== undefined &&
      !isBoundedLaunchProfileId(value.resolved_profile)) ||
    (value.existing_profiles !== undefined &&
      (!Array.isArray(value.existing_profiles) ||
        value.existing_profiles.length > MAX_LAUNCH_EXISTING_PROFILES ||
        !value.existing_profiles.every(isBoundedLaunchProfileId)))
  ) {
    return null;
  }
  const existingProfiles = value.existing_profiles ?? [];
  const resolvedProfile = value.resolved_profile;
  const singleProfileDecision =
    value.decision === "resume" || value.decision === "activate";
  if (
    (value.decision === "no_profile" &&
      (resolvedProfile !== undefined || existingProfiles.length !== 0)) ||
    (singleProfileDecision &&
      (!isBoundedLaunchProfileId(resolvedProfile) ||
        existingProfiles.length !== 0)) ||
    (value.decision === "cross_profile" &&
      (!isBoundedLaunchProfileId(resolvedProfile) ||
        existingProfiles.length === 0 ||
        new Set(existingProfiles).size !== existingProfiles.length ||
        existingProfiles.includes(resolvedProfile)))
  ) {
    return null;
  }
  return {
    decision: value.decision as LaunchResolveResult["decision"],
    ...optionalString(value.resolved_profile, "resolved_profile"),
    existing_profiles: existingProfiles,
  };
}

function isBoundedLaunchProfileId(value: unknown): value is string {
  return (
    isNonEmptyString(value) && value.length <= MAX_LAUNCH_PROFILE_ID_LENGTH
  );
}

export function parseSessionListResult(
  value: unknown,
): SessionListResult | null {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
  const sessions = value.sessions.map(parseSessionEntry);
  return sessions.some((entry) => entry === null)
    ? null
    : { sessions: sessions as SessionListEntry[] };
}

export function parseSessionDeleteResult(
  value: unknown,
): SessionDeleteResult | null {
  return isRecord(value) ? {} : null;
}

export function parseSessionFilesListResult(
  value: unknown,
): SessionFilesListResult | null {
  if (!isRecord(value) || !Array.isArray(value.files)) return null;
  const files = value.files.map(parseSessionFile);
  return files.some((file) => file === null)
    ? null
    : { files: files as SessionFileInfo[] };
}

function parseSessionEntry(value: unknown): SessionListEntry | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.id) ||
    !isNonNegativeInteger(value.message_count) ||
    !optionalStringsValid(value, ["title", "updated_at", "last_prompt"])
  ) {
    return null;
  }
  return {
    id: value.id,
    message_count: value.message_count,
    ...optionalString(value.title, "title"),
    ...optionalString(value.updated_at, "updated_at"),
    ...optionalString(value.last_prompt, "last_prompt"),
  };
}

function parseSessionFile(value: unknown): SessionFileInfo | null {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value.filename) ||
    !isNonEmptyString(value.path) ||
    !isNonNegativeInteger(value.size_bytes) ||
    typeof value.modified_at !== "string"
  ) {
    return null;
  }
  return {
    filename: value.filename,
    path: value.path,
    size_bytes: value.size_bytes,
    modified_at: value.modified_at,
  };
}

function optionalStringsValid(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every(
    (key) => value[key] === undefined || typeof value[key] === "string",
  );
}

function optionalString<Key extends string>(value: unknown, key: Key) {
  return typeof value === "string"
    ? ({ [key]: value } as Record<Key, string>)
    : {};
}
