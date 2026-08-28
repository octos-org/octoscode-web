import type {
  ModelOption,
  ModelSelection,
  SessionPermissionOption,
  SettingsSectionId,
} from "./types.ts";

export type PermissionSelectionIntent =
  | { kind: "none" }
  | { kind: "confirm"; option: SessionPermissionOption }
  | { kind: "select"; option: SessionPermissionOption };

/**
 * Decide how a permission menu choice may proceed.
 *
 * Dangerous presets can never become a direct select intent. This function is
 * shared by the component and tests so the safety boundary is independent of
 * DOM timing.
 */
export function permissionSelectionIntent(
  option: SessionPermissionOption,
  selectedId: string | null,
  locked: boolean,
): PermissionSelectionIntent {
  if (locked || option.id === selectedId) return { kind: "none" };
  if (option.risk === "dangerous") return { kind: "confirm", option };
  return { kind: "select", option };
}

export type ModelSelectionIntent =
  { kind: "none" } | { kind: "select"; selection: ModelSelection };

/** Return a model selection only for a new, currently usable catalog entry. */
export function modelSelectionIntent(
  providerId: string,
  model: ModelOption,
  selected: ModelSelection | null,
  locked: boolean,
): ModelSelectionIntent {
  if (
    locked ||
    !model.available ||
    (selected?.providerId === providerId && selected.modelId === model.id)
  ) {
    return { kind: "none" };
  }
  return {
    kind: "select",
    selection: { providerId, modelId: model.id },
  };
}

/** Restrict navigation to the two product sections owned by this shell. */
export function settingsNavigationIntent(
  current: SettingsSectionId,
  next: SettingsSectionId,
): SettingsSectionId | null {
  return current === next ? null : next;
}
