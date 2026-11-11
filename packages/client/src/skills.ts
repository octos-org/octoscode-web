import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { APPUI_SKILL_METHODS } from "./skill-methods.ts";

export interface InstalledSkill {
  name: string;
  version: string | null;
  toolCount: number;
  sourceRepo: string | null;
  /** Actual reviewed identity, present only on reviewed installs. */
  sourceCommit: string | null;
  reviewedAt: string | null;
  artifactSha256: string | null;
}
export interface SkillBinaryProof {
  url: string;
  sha256: string | null;
  signature: string | null;
}
export interface SkillPackage {
  name: string;
  description: string;
  repo: string;
  version: string | null;
  author: string | null;
  license: string | null;
  skills: string[];
  requires: string[];
  providesTools: boolean;
  tags: string[];
  installed: boolean;
  installedSkills: string[];
  /** Full 40-hex reviewed source commit, when the registry reports one. */
  sourceCommit: string | null;
  reviewedAt: string | null;
  /** Per-platform (`{os}-{arch}`) downloadable artifact proofs. */
  binaries: Record<string, SkillBinaryProof>;
}
/** `profile/skills/registry/search` result (UPCR-2026-R79767D0C). */
export interface SkillRegistrySearch {
  /** The Core host platform the reviewed-install gate validates against. */
  serverPlatform: string | null;
  packages: SkillPackage[];
}
export interface SkillReviewedInstallParams {
  package: string;
  repo: string;
  sourceCommit: string;
  reviewedAt: string;
  platform: string;
  artifact?: { sha256: string; signature: string };
}
export interface SkillReviewedInstallResult {
  profileId: string;
  installed: string[];
  package: string;
  repo: string;
  sourceCommit: string;
  reviewedAt: string;
  platform: string;
  artifactSha256: string | null;
  artifactBytes: number | null;
}
const text = (v: unknown): v is string =>
  typeof v === "string" && v.length <= 8192;
const name = (v: unknown): v is string => text(v) && v.trim().length > 0;
const nullableText = (v: unknown): v is string | null => v === null || text(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 10000 && v.every(text);
const rows = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.length <= 10000;
const count = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const commit = (v: unknown): v is string | null =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && /^[0-9a-f]{40}$/.test(v));
const digest = (v: unknown): v is string | null =>
  v === undefined ||
  v === null ||
  (typeof v === "string" && /^[0-9a-f]{64}$/.test(v));
const timestamp = (v: unknown): v is string | null =>
  v === undefined || nullableText(v);
const bytes = (v: unknown): v is number | null =>
  v === undefined || v === null || count(v);
const exactCommit = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

/** Narrow projection of the audited rc11 SkillEntry wire, including explicit nulls. */
export function parseInstalledSkills(
  value: unknown,
  profileId: string,
): InstalledSkill[] | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    !rows(value.skills) ||
    !count(value.count) ||
    value.count !== value.skills.length
  )
    return null;
  const result: InstalledSkill[] = [];
  const names = new Set<string>();
  for (const row of value.skills) {
    if (
      !isRecord(row) ||
      !name(row.name) ||
      names.has(row.name) ||
      !nullableText(row.version) ||
      !nullableText(row.source_repo) ||
      !count(row.tool_count) ||
      !commit(row.source_commit) ||
      !timestamp(row.reviewed_at) ||
      !digest(row.artifact_sha256)
    )
      return null;
    names.add(row.name);
    result.push({
      name: row.name,
      version: row.version,
      toolCount: row.tool_count,
      sourceRepo: row.source_repo,
      sourceCommit: row.source_commit ?? null,
      reviewedAt: row.reviewed_at ?? null,
      artifactSha256: row.artifact_sha256 ?? null,
    });
  }
  return result;
}

export function parseSkillRegistry(
  value: unknown,
  profileId: string,
): SkillRegistrySearch | null {
  if (!isRecord(value) || value.profile_id !== profileId) return null;
  if (
    value.server_platform !== undefined &&
    (typeof value.server_platform !== "string" ||
      !value.server_platform.length ||
      value.server_platform.length > 64)
  )
    return null;
  if (!rows(value.packages)) return null;
  const packages: SkillPackage[] = [];
  const names = new Set<string>();
  for (const row of value.packages) {
    if (
      !isRecord(row) ||
      !name(row.name) ||
      names.has(row.name) ||
      !text(row.description) ||
      !name(row.repo) ||
      !nullableText(row.version) ||
      !nullableText(row.author) ||
      !nullableText(row.license) ||
      !strings(row.skills) ||
      !strings(row.requires) ||
      !strings(row.tags) ||
      !strings(row.installed_skills) ||
      typeof row.provides_tools !== "boolean" ||
      typeof row.installed !== "boolean" ||
      !commit(row.source_commit) ||
      !timestamp(row.reviewed_at)
    )
      return null;
    const binaries: Record<string, SkillBinaryProof> = {};
    if (row.binaries !== undefined) {
      if (!isRecord(row.binaries)) return null;
      const entries = Object.entries(row.binaries);
      if (entries.length > 64) return null;
      for (const [platform, proof] of entries) {
        if (
          !platform.length ||
          platform.length > 64 ||
          !isRecord(proof) ||
          !text(proof.url) ||
          !nullableText(proof.sha256) ||
          !nullableText(proof.signature)
        )
          return null;
        binaries[platform] = {
          url: proof.url,
          sha256: proof.sha256,
          signature: proof.signature,
        };
      }
    }
    names.add(row.name);
    packages.push({
      name: row.name,
      description: row.description,
      repo: row.repo,
      version: row.version,
      author: row.author,
      license: row.license,
      skills: row.skills,
      requires: row.requires,
      tags: row.tags,
      providesTools: row.provides_tools,
      installed: row.installed,
      installedSkills: row.installed_skills,
      sourceCommit: row.source_commit ?? null,
      reviewedAt: row.reviewed_at ?? null,
      binaries,
    });
  }
  return {
    serverPlatform:
      value.server_platform === undefined ? null : value.server_platform,
    packages,
  };
}

/** Profile-scoped operations; callers explicitly confirm every installation/removal. */
export function createSkillCommands(
  client: { request(method: string, params: unknown): Promise<unknown> },
  profileId: string,
  capabilities: UiProtocolCapabilities,
) {
  function available(method: string) {
    if (!name(profileId)) throw new Error("A confirmed profile is required");
    if (!supportsMethod(capabilities, method))
      throw new Error(`${method} is not advertised by this server`);
  }
  return {
    async list(): Promise<InstalledSkill[]> {
      available(APPUI_SKILL_METHODS.LIST);
      const value = await client.request(APPUI_SKILL_METHODS.LIST, {
        profile_id: profileId,
      });
      const parsed = parseInstalledSkills(value, profileId);
      if (!parsed) throw new Error("Invalid or wrong-profile installed skills");
      return parsed;
    },
    async search(query: string): Promise<SkillRegistrySearch> {
      available(APPUI_SKILL_METHODS.SEARCH);
      if (!text(query)) throw new Error("Invalid registry query");
      const value = await client.request(APPUI_SKILL_METHODS.SEARCH, {
        profile_id: profileId,
        q: query.trim(),
      });
      const parsed = parseSkillRegistry(value, profileId);
      if (!parsed) throw new Error("Invalid or wrong-profile skill registry");
      return parsed;
    },
    /**
     * Install exactly the reviewed object (UPCR-2026-R48CB467B). The server
     * re-checks every expected field against the current registry and the
     * downloaded bytes before publishing; the receipt must echo that identity.
     */
    async installReviewed(
      params: SkillReviewedInstallParams,
    ): Promise<SkillReviewedInstallResult> {
      available(APPUI_SKILL_METHODS.INSTALL_REVIEWED);
      const value = await client.request(APPUI_SKILL_METHODS.INSTALL_REVIEWED, {
        profile_id: profileId,
        package: params.package,
        repo: params.repo,
        source_commit: params.sourceCommit,
        reviewed_at: params.reviewedAt,
        platform: params.platform,
        ...(params.artifact ? { artifact: params.artifact } : {}),
        force: false,
      });
      if (
        !isRecord(value) ||
        value.profile_id !== profileId ||
        value.ok !== true ||
        !strings(value.installed) ||
        !name(value.package) ||
        !name(value.repo) ||
        !exactCommit(value.source_commit) ||
        !name(value.reviewed_at) ||
        !name(value.platform) ||
        !digest(value.artifact_sha256) ||
        !bytes(value.artifact_bytes)
      )
        throw new Error(
          "Invalid or wrong-profile skill installation result; refresh before retrying",
        );
      return {
        profileId,
        installed: value.installed,
        package: value.package,
        repo: value.repo,
        sourceCommit: value.source_commit,
        reviewedAt: value.reviewed_at,
        platform: value.platform,
        artifactSha256: value.artifact_sha256 ?? null,
        artifactBytes: value.artifact_bytes ?? null,
      };
    },
    async remove(skillName: string): Promise<void> {
      available(APPUI_SKILL_METHODS.REMOVE);
      if (!name(skillName)) throw new Error("A skill name is required");
      const value = await client.request(APPUI_SKILL_METHODS.REMOVE, {
        profile_id: profileId,
        name: skillName,
      });
      if (
        !isRecord(value) ||
        value.profile_id !== profileId ||
        value.ok !== true ||
        value.removed !== skillName
      )
        throw new Error(
          "Invalid or wrong-profile skill removal result; refresh before retrying",
        );
    },
  };
}
