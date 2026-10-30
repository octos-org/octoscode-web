import { CORE_UI_METHODS } from "./generated/core-contract.ts";

export const APPUI_MEMORY_REQUEST_METHOD = CORE_UI_METHODS.MEMORY_REQUEST;
export const APPUI_MEMORY_PROMOTE_METHOD = CORE_UI_METHODS.MEMORY_PROMOTE;

// Additive capability; older kernels ignore session_id on memory reads/writes.
export const APPUI_MEMORY_SESSION_SCOPE_FEATURE = "memory.session_scope.v1";
