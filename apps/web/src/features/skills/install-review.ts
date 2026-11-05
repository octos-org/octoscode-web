import type {
  InstalledSkill,
  SkillInstallResult,
  SkillPackage,
} from "@octos-org/octoscode-client/skills";
import { errorMessage } from "../../shared/errors.ts";

/** Exactly what `profile/skills/install` will be asked for. */
export interface InstallSource {
  repo: string;
  /** Empty means the server's default branch. */
  branch: string;
  /** The registry package the review started from, if any. */
  packageName?: string;
}

/** What the server's registry can say about a source. */
export type RegistryStanding =
  "listed" | "unlisted" | "not-offered" | "server-path";

export interface InstallReview {
  source: InstallSource;
  standing: RegistryStanding;
  package: SkillPackage | null;
}

/** A reviewed fact that no longer holds. */
export interface ReviewChange {
  field: ReviewField;
  before: string;
  after: string;
}

const PACKAGE_FIELDS = [
  "name",
  "description",
  "version",
  "author",
  "license",
  "skills",
  "requires",
  "providesTools",
  "tags",
] as const;
export type ReviewField = (typeof PACKAGE_FIELDS)[number] | "standing";

/** Core resolves these on its own disk, so no registry entry describes them. */
export function isServerPath(repo: string): boolean {
  return /^(\/|~|\.{1,2}[/\\]|\\\\|[A-Za-z]:[\\/])|^\.{1,2}$/.test(repo);
}

/**
 * A source matches one registry entry exactly or none. Several entries sharing
 * a repo can't speak for it, because Core installs the whole repo.
 */
export function findPackage(
  packages: readonly SkillPackage[],
  source: InstallSource,
): SkillPackage | null {
  const matches = packages.filter(
    (item) =>
      item.repo === source.repo &&
      (source.packageName === undefined || item.name === source.packageName),
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** Rejects when the registry can't be read: that is not the same as unlisted. */
export async function readInstallReview(
  source: InstallSource,
  readRegistry: (() => Promise<SkillPackage[]>) | null,
): Promise<InstallReview> {
  if (isServerPath(source.repo))
    return { source, standing: "server-path", package: null };
  if (!readRegistry) return { source, standing: "not-offered", package: null };
  const item = findPackage(await readRegistry(), source);
  return { source, standing: item ? "listed" : "unlisted", package: item };
}

function factText(value: string | readonly string[] | boolean | null): string {
  if (Array.isArray(value)) return value.join(", ");
  return value === null ? "" : String(value);
}

/** Empty when a confirmation still applies to what the server says now. */
export function reviewChanges(
  reviewed: InstallReview,
  latest: InstallReview,
): ReviewChange[] {
  const changes: ReviewChange[] = [];
  if (reviewed.standing !== latest.standing)
    changes.push({
      field: "standing",
      before: reviewed.standing,
      after: latest.standing,
    });
  if (!reviewed.package || !latest.package) return changes;
  for (const field of PACKAGE_FIELDS) {
    const before = factText(reviewed.package[field]);
    const after = factText(latest.package[field]);
    if (before !== after) changes.push({ field, before, after });
  }
  return changes;
}

/**
 * Core has no way to pin what it installs, so this is only known afterwards:
 * the server reports a version other than the one the registry stated.
 */
export function installedVersionsDiffer(
  reviewedVersion: string | null,
  result: SkillInstallResult,
  skills: readonly InstalledSkill[] | null,
): boolean {
  if (!reviewedVersion || !skills) return false;
  return result.installed.some((name) => {
    const version = skills.find((skill) => skill.name === name)?.version;
    return Boolean(version) && version !== reviewedVersion;
  });
}

/** A source URL can carry credentials, and Core's errors repeat the source. */
export function withoutCredentials(text: string): string {
  return text.replace(/(:\/\/)[^/\s@]+@/g, "$1[redacted]@");
}

export function skillErrorText(reason: unknown): string {
  return withoutCredentials(errorMessage(reason)).slice(0, 512);
}
