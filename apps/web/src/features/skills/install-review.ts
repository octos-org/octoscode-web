import type {
  SkillPackage,
  SkillRegistrySearch,
  SkillReviewedInstallResult,
} from "@octos-org/octoscode-client/skills";
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
  /** Host platform from the SAME registry read the package came from. */
  serverPlatform: string | null;
}

/**
 * The exact object a reviewed install asks the server for. Every field is an
 * EXPECTED value from the review snapshot; the server refuses any drift.
 */
export interface ReviewedInstallPlan {
  package: string;
  repo: string;
  sourceCommit: string;
  reviewedAt: string;
  platform: string;
  artifact: { sha256: string; signature: string } | null;
}

/** Why a review cannot offer an install. */
export type InstallUnavailable =
  | "no-capability"
  | "not-listed"
  | "no-commit"
  | "no-review-time"
  | "no-platform"
  | "artifact-missing"
  | "artifact-incomplete";

export type InstallDecision =
  | { ok: true; plan: ReviewedInstallPlan }
  | { ok: false; reason: InstallUnavailable };

const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Install is offered only when the server negotiated the reviewed-install
 * capability, the review came from one registry read that still pins the
 * commit, and the package's artifact (if any) covers the host platform.
 */
export function reviewInstallDecision(
  review: InstallReview,
  gate: { methodOffered: boolean; featureNegotiated: boolean },
): InstallDecision {
  if (!gate.methodOffered || !gate.featureNegotiated)
    return { ok: false, reason: "no-capability" };
  const item = review.package;
  if (review.standing !== "listed" || !item)
    return { ok: false, reason: "not-listed" };
  if (!item.sourceCommit || !COMMIT.test(item.sourceCommit))
    return { ok: false, reason: "no-commit" };
  if (!item.reviewedAt) return { ok: false, reason: "no-review-time" };
  const platform = review.serverPlatform;
  if (!platform) return { ok: false, reason: "no-platform" };
  let artifact: ReviewedInstallPlan["artifact"] = null;
  const binaries = Object.keys(item.binaries);
  if (binaries.length > 0) {
    const proof = item.binaries[platform];
    if (!proof) return { ok: false, reason: "artifact-missing" };
    if (!proof.sha256 || !SHA256.test(proof.sha256) || !proof.signature)
      return { ok: false, reason: "artifact-incomplete" };
    artifact = { sha256: proof.sha256, signature: proof.signature };
  }
  return {
    ok: true,
    plan: {
      package: item.name,
      repo: item.repo,
      sourceCommit: item.sourceCommit,
      reviewedAt: item.reviewedAt,
      platform,
      artifact,
    },
  };
}

/**
 * The receipt must echo the reviewed identity exactly. Anything else — even a
 * successful-looking `ok` — means the installed object is not the reviewed one.
 */
export function receiptMatchesPlan(
  plan: ReviewedInstallPlan,
  receipt: SkillReviewedInstallResult,
): boolean {
  return (
    receipt.package === plan.package &&
    receipt.repo === plan.repo &&
    receipt.sourceCommit === plan.sourceCommit &&
    receipt.reviewedAt === plan.reviewedAt &&
    receipt.platform === plan.platform &&
    receipt.artifactSha256 === (plan.artifact?.sha256 ?? null)
  );
}

/** Stable refusal kinds the UI renders as their own honest state. */
export const REVIEWED_INSTALL_ERROR_KINDS = new Set([
  "reviewed_install_invalid_params",
  "reviewed_install_registry_mismatch",
  "reviewed_install_verification_failed",
  "reviewed_install_fetch_failed",
  "reviewed_install_platform_unavailable",
  "reviewed_install_already_installed",
  "reviewed_install_unsupported_layout",
  "reviewed_install_unsafe_tree",
  "reviewed_install_publish_failed",
  "reviewed_install_rebuild_failed",
]);

/** Extracts Core's typed refusal kind from a protocol error, else null. */
export function reviewedInstallErrorKind(cause: unknown): string | null {
  const data =
    cause !== null && typeof cause === "object" && "data" in cause
      ? (cause as { data?: unknown }).data
      : undefined;
  if (data === null || typeof data !== "object") return null;
  const kind = (data as { kind?: unknown }).kind;
  return typeof kind === "string" && REVIEWED_INSTALL_ERROR_KINDS.has(kind)
    ? kind
    : null;
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
  readRegistry: (() => Promise<SkillRegistrySearch>) | null,
): Promise<InstallReview> {
  const empty = { serverPlatform: null, packages: [] as SkillPackage[] };
  if (isServerPath(source.repo))
    return { source, standing: "server-path", package: null, ...empty };
  if (!readRegistry)
    return { source, standing: "not-offered", package: null, ...empty };
  const registry = await readRegistry();
  const item = findPackage(registry.packages, source);
  return {
    source,
    standing: item ? "listed" : "unlisted",
    package: item,
    serverPlatform: registry.serverPlatform,
  };
}

/** A source URL can carry credentials, and Core's errors repeat the source. */
export function withoutCredentials(text: string): string {
  return text.replace(/(:\/\/)[^/\s@]+@/g, "$1[redacted]@");
}

export function skillErrorText(reason: unknown): string {
  return withoutCredentials(errorMessage(reason)).slice(0, 512);
}
