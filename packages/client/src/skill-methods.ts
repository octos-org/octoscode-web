export const APPUI_SKILL_METHODS = {
  LIST: "profile/skills/list",
  SEARCH: "profile/skills/registry/search",
  INSTALL: "profile/skills/install",
  INSTALL_REVIEWED: "profile/skills/install_reviewed",
  REMOVE: "profile/skills/remove",
} as const;

/**
 * UPCR-2026-R48CB467B: strict opt-in reviewed install. A Core without this
 * token has no `profile/skills/install_reviewed` either, so the client never
 * offers an install there; the legacy branch-following install stays unused.
 */
export const SKILLS_REVIEWED_INSTALL_FEATURE =
  "profile.skills.reviewed_install.v1";

export const APPUI_SKILL_ACTION_METHODS = {
  LIST: "skill/action/list",
  INVOKE: "skill/action/invoke",
  JOB_LIST: "skill/action/job/list",
  JOB_READ: "skill/action/job/read",
} as const;

export const SKILL_ACTIONS_UI_FEATURE = "skill.actions.v1";
export const SKILL_ACTION_JOBS_UI_FEATURE = "skill.action_jobs.v1";
