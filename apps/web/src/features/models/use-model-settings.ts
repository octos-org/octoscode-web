import { useMemo, useRef, useState } from "react";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import {
  emptyModelSettingsState,
  ModelSettingsController,
  type ModelSettingsClient,
  type ModelSettingsDraft,
} from "./model-settings.ts";

export interface UseModelSettingsDependencies {
  client: () => ModelSettingsClient | null;
  profileId: () => string;
}

/** React ownership adapter for the profile-scoped model settings controller. */
export function useModelSettings(dependencies: UseModelSettingsDependencies) {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const [state, setState] = useState(emptyModelSettingsState);
  const controllerRef = useRef<ModelSettingsController | null>(null);

  controllerRef.current ??= new ModelSettingsController({
    client: () => dependenciesRef.current.client(),
    profileId: () => dependenciesRef.current.profileId(),
    publish: setState,
  });
  const controller = controllerRef.current;
  const actions = useMemo(
    () => ({
      configureCapabilities: (
        capabilities: UiProtocolCapabilities | undefined,
      ) => controller.configureCapabilities(capabilities),
      reset: () => controller.reset(),
      refresh: () => controller.refresh(),
      test: (draft: ModelSettingsDraft, apiKey?: string) =>
        controller.test(draft, apiKey),
      fetchModels: (
        draft: Pick<ModelSettingsDraft, "familyId" | "route">,
        apiKey?: string,
      ) => controller.fetchModels(draft, apiKey),
      save: (draft: ModelSettingsDraft, apiKey?: string) =>
        controller.save(draft, apiKey),
      delete: (
        target: Pick<ModelSettingsDraft, "familyId" | "modelId" | "route">,
      ) => controller.delete(target),
    }),
    [controller],
  );

  return {
    state,
    ...actions,
  };
}
