import { isRecord } from "./rpc.ts";
import { supportsMethod } from "./interaction.ts";
import type { UiProtocolCapabilities } from "./types.ts";
import { APPUI_SKILL_METHODS } from "./skill-methods.ts";

export interface InstalledSkill {
  name: string;
  version: string | null;
  toolCount: number;
  sourceRepo: string | null;
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
}
export interface SkillInstallResult {
  profileId: string;
  installed: string[];
  skipped: string[];
  dependenciesInstalled: string[];
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
      !count(row.tool_count)
    )
      return null;
    names.add(row.name);
    result.push({
      name: row.name,
      version: row.version,
      toolCount: row.tool_count,
      sourceRepo: row.source_repo,
    });
  }
  return result;
}

export function parseSkillPackages(
  value: unknown,
  profileId: string,
): SkillPackage[] | null {
  if (
    !isRecord(value) ||
    value.profile_id !== profileId ||
    !rows(value.packages)
  )
    return null;
  const result: SkillPackage[] = [];
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
      typeof row.installed !== "boolean"
    )
      return null;
    names.add(row.name);
    result.push({
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
    });
  }
  return result;
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
    async search(query: string): Promise<SkillPackage[]> {
      available(APPUI_SKILL_METHODS.SEARCH);
      if (!text(query)) throw new Error("Invalid registry query");
      const value = await client.request(APPUI_SKILL_METHODS.SEARCH, {
        profile_id: profileId,
        q: query.trim(),
      });
      const parsed = parseSkillPackages(value, profileId);
      if (!parsed) throw new Error("Invalid or wrong-profile skill registry");
      return parsed;
    },
    async install(repo: string, branch?: string): Promise<SkillInstallResult> {
      available(APPUI_SKILL_METHODS.INSTALL);
      if (!name(repo) || (branch !== undefined && !name(branch)))
        throw new Error("A source and nonempty branch are required");
      const value = await client.request(APPUI_SKILL_METHODS.INSTALL, {
        profile_id: profileId,
        repo: repo.trim(),
        ...(branch ? { branch: branch.trim() } : {}),
        force: false,
      });
      if (
        !isRecord(value) ||
        value.profile_id !== profileId ||
        value.ok !== true ||
        !strings(value.installed) ||
        !strings(value.skipped) ||
        !strings(value.deps_installed)
      )
        throw new Error(
          "Invalid or wrong-profile skill installation result; refresh before retrying",
        );
      return {
        profileId,
        installed: value.installed,
        skipped: value.skipped,
        dependenciesInstalled: value.deps_installed,
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
