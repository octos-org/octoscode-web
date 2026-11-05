import type { SkillPackage } from "@octos-org/octoscode-client/skills";
import { errorMessage } from "../../shared/errors.ts";

/** A source as `profile/skills/install` would take it. */
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

/** A source URL can carry credentials, and Core's errors repeat the source. */
export function withoutCredentials(text: string): string {
  return text.replace(/(:\/\/)[^/\s@]+@/g, "$1[redacted]@");
}

export function skillErrorText(reason: unknown): string {
  return withoutCredentials(errorMessage(reason)).slice(0, 512);
}
