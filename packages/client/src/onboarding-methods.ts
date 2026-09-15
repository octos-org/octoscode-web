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
