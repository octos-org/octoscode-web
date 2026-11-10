import { CORE_UI_METHODS } from "./generated/core-contract.ts";

export const APPUI_MEMORY_REQUEST_METHOD = CORE_UI_METHODS.MEMORY_REQUEST;
export const APPUI_MEMORY_PROMOTE_METHOD = CORE_UI_METHODS.MEMORY_PROMOTE;

// Additive capability; older kernels ignore session_id on memory reads/writes.
export const APPUI_MEMORY_SESSION_SCOPE_FEATURE = "memory.session_scope.v1";

// UPCR-2026-RD1002E7E (Core #3179), newer than the pinned contract: list
// long-term entries, and edit or delete one synchronously by id and version.
export const APPUI_MEMORY_ENTRY_METHODS = {
  ENTRIES: "memory/entries",
  EDIT: "memory/edit",
  DELETE: "memory/delete",
} as const;

/** Core's `resource_conflict`: the version given is not the stored one. */
export const MEMORY_VERSION_CONFLICT_CODE = -32_171;
