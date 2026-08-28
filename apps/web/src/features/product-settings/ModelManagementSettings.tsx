import { useEffect } from "react";
import type { UiProtocolCapabilities } from "@octos-org/octoscode-client";
import type { ModelSettingsClient } from "../models/model-settings.ts";
import { useModelSettings } from "../models/use-model-settings.ts";
import {
  ModelManagementSection,
  type ConfiguredModelProvider,
  type ModelProviderDraft,
  type ModelProviderSaveRequest,
} from "./ModelManagementSection.tsx";
import {
  modelSettingsDeleteTarget,
  modelSettingsDraftFromProvider,
  projectModelManagement,
} from "./model-management-projection.ts";

export interface ModelManagementSettingsProps {
  client: ModelSettingsClient | null;
  profileId: string;
  capabilities: UiProtocolCapabilities | undefined;
  profileDefaultKey: string;
  locked: boolean;
  onConfiguredModelsChange: () => Promise<void>;
}

/** Lazy product adapter that keeps Models-only projection out of initial JS. */
export function ModelManagementSettings({
  client,
  profileId,
  capabilities,
  profileDefaultKey,
  locked,
  onConfiguredModelsChange,
}: ModelManagementSettingsProps) {
  const management = useModelSettings({
    client: () => client,
    profileId: () => profileId,
  });
  const { configureCapabilities, reset, refresh } = management;

  useEffect(() => {
    configureCapabilities(capabilities);
    if (client && profileId) void refresh();
    return reset;
  }, [
    capabilities,
    client,
    configureCapabilities,
    profileDefaultKey,
    profileId,
    refresh,
    reset,
  ]);

  const state = management.state;
  const projection = projectModelManagement(state);
  const operationCapabilities = state.capabilities;
  const viewState = profileId
    ? projection.state
    : {
        status: "unavailable" as const,
        message: "Octos did not identify an active Profile for model settings.",
      };

  const testProvider = async (draft: ModelProviderDraft) => {
    const result = await management.test(
      modelSettingsDraftFromProvider(draft, false),
      draft.apiKey,
    );
    if (!result?.applied || result.error) {
      throw new Error("The provider test did not pass.");
    }
  };

  const fetchProviderModels = async (draft: ModelProviderDraft) => {
    const result = await management.fetchModels(
      modelSettingsDraftFromProvider(draft, false),
      draft.apiKey,
    );
    if (!result) throw new Error("The provider model catalog was unavailable.");
    return result.models.map((id) => ({ id }));
  };

  const saveProvider = async (request: ModelProviderSaveRequest) => {
    const existing = request.providerId
      ? projection.providers.find(
          (provider) => provider.id === request.providerId,
        )
      : null;
    const configuration = state.configuration;
    if (!configuration) {
      throw new Error("The active Profile configuration is not authoritative.");
    }
    const setPrimary =
      existing?.primary === true ||
      (configuration.primary === null && configuration.fallbacks.length === 0);
    const result = await management.save(
      modelSettingsDraftFromProvider(request.draft, setPrimary),
      request.draft.apiKey,
    );
    if (!result?.mutation.applied) {
      throw new Error("The provider configuration was not saved.");
    }
    await onConfiguredModelsChange();
  };

  const deleteProvider = async (provider: ConfiguredModelProvider) => {
    const result = await management.delete(modelSettingsDeleteTarget(provider));
    if (!result?.applied) {
      throw new Error("The provider configuration was not deleted.");
    }
    await onConfiguredModelsChange();
  };

  return (
    <ModelManagementSection
      state={viewState}
      providers={projection.providers}
      families={projection.families}
      apiProtocols={projection.apiProtocols}
      locked={locked || state.phase !== "idle"}
      onRetry={() => void management.refresh()}
      {...(operationCapabilities.test
        ? { onTestConnection: testProvider }
        : {})}
      {...(operationCapabilities.fetchModels
        ? { onFetchAvailableModels: fetchProviderModels }
        : {})}
      {...(operationCapabilities.test && operationCapabilities.save
        ? { onSave: saveProvider }
        : {})}
      {...(operationCapabilities.delete ? { onDelete: deleteProvider } : {})}
    />
  );
}
