import { CORE_UI_METHODS } from "./generated/core-contract.ts";

/** AppUI transport extensions owned by octos-cli until Core exports them. */
export const APPUI_ONBOARDING_METHODS = {
  PROFILE_LOCAL_CREATE: CORE_UI_METHODS.PROFILE_LOCAL_CREATE,
  PROFILE_LLM_CATALOG: "profile/llm/catalog",
  PROFILE_LLM_DELETE: "profile/llm/delete",
  PROFILE_LLM_FETCH_MODELS: "profile/llm/fetch_models",
  PROFILE_LLM_LIST: "profile/llm/list",
  PROFILE_LLM_SELECT: "profile/llm/select",
  PROFILE_LLM_TEST: "profile/llm/test",
  PROFILE_LLM_UPSERT: "profile/llm/upsert",
} as const;

/**
 * Folder browsing is a separate, optional capability. It must stay OUT of
 * APPUI_ONBOARDING_METHODS: the onboarding panel requires EVERY method in that
 * map, so listing these there made a server without browsing report that it
 * cannot onboard from the Web at all.
 */
export const APPUI_WORKSPACE_BROWSE_METHODS = {
  /** WEB-WORKSPACE-BROWSER-CONTRACT-5000 §1. */
  WORKSPACE_LIST: "onboarding/workspace_list",
  /** WEB-WORKSPACE-BROWSER-CONTRACT-5000 §2. */
  WORKSPACE_CREATE: "onboarding/workspace_create",
} as const;

/** Onboarding features advertised in `config/capabilities/list`. */
export const APPUI_ONBOARDING_FEATURES = {
  WORKSPACE_BROWSE_V1: "onboarding.workspace_browse.v1",
} as const;
