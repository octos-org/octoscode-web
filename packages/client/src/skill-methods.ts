export const APPUI_SKILL_METHODS = {
  LIST: "profile/skills/list",
  SEARCH: "profile/skills/registry/search",
  INSTALL: "profile/skills/install",
  REMOVE: "profile/skills/remove",
} as const;

export const APPUI_SKILL_ACTION_METHODS = {
  LIST: "skill/action/list",
  INVOKE: "skill/action/invoke",
  JOB_LIST: "skill/action/job/list",
  JOB_READ: "skill/action/job/read",
} as const;

export const SKILL_ACTIONS_UI_FEATURE = "skill.actions.v1";
export const SKILL_ACTION_JOBS_UI_FEATURE = "skill.action_jobs.v1";
